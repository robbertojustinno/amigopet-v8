from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.user import User
from app.models.pet import Pet
from app.models.walk_request import WalkRequest
from app.models.message import Message
from app.schemas.user import UserCreate, UserLogin, UserOut
from app.schemas.pet import PetCreate, PetOut
from app.schemas.walk_request import WalkRequestCreate, WalkRequestAction, WalkRequestPay, WalkRequestOut
from app.schemas.message import MessageCreate, MessageOut
from app.services.redis_service import redis_service
from app.services.payment_service import payment_service

router = APIRouter()

ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}


@router.post("/uploads/profile-photo")
async def upload_profile_photo(file: UploadFile = File(...)):
    if not file.content_type or file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Envie uma imagem JPG, PNG, WEBP ou GIF.")

    uploads_dir = Path("storage/profile_photos")
    uploads_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename or "foto").suffix.lower() or ALLOWED_IMAGE_TYPES[file.content_type]
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        suffix = ALLOWED_IMAGE_TYPES[file.content_type]

    filename = f"{uuid4().hex}{suffix}"
    destination = uploads_dir / filename
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="A imagem deve ter no máximo 5 MB.")

    destination.write_bytes(content)
    return {"file_url": f"/storage/profile_photos/{filename}", "filename": filename}

@router.get("/health")
def health():
    return {
        "ok": True,
        "app": settings.APP_NAME,
        "default_address": settings.DEFAULT_ADDRESS
    }

@router.post("/users/register", response_model=UserOut)
def register_user(payload: UserCreate, db: Session = Depends(get_db)):
    if payload.role not in {"client", "walker"}:
        raise HTTPException(status_code=400, detail="Role inválida.")

    if payload.role == "walker" and not payload.profile_photo:
        raise HTTPException(status_code=400, detail="Passeador precisa enviar foto obrigatoriamente.")

    exists = db.scalar(select(User).where(User.email == payload.email))
    if exists:
        raise HTTPException(status_code=400, detail="E-mail já cadastrado.")

    user = User(
        full_name=payload.full_name,
        email=payload.email,
        password=payload.password,
        role=payload.role,
        neighborhood=payload.neighborhood,
        city=payload.city,
        address=payload.address or settings.DEFAULT_ADDRESS,
        profile_photo=payload.profile_photo,
        online=False,
        active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@router.post("/users/login", response_model=UserOut)
def login_user(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email, User.password == payload.password))
    if not user:
        raise HTTPException(status_code=401, detail="Credenciais inválidas.")
    user.online = True
    db.commit()
    db.refresh(user)
    return user

@router.get("/walkers", response_model=list[UserOut])
def list_walkers(neighborhood: str | None = None, city: str | None = None, db: Session = Depends(get_db)):
    query = select(User).where(User.role == "walker", User.active == True)
    if neighborhood:
        query = query.where(User.neighborhood.ilike(f"%{neighborhood}%"))
    if city:
        query = query.where(User.city.ilike(f"%{city}%"))
    return list(db.scalars(query).all())

@router.post("/pets", response_model=PetOut)
def create_pet(payload: PetCreate, db: Session = Depends(get_db)):
    owner = db.get(User, payload.owner_id)
    if not owner or owner.role != "client":
        raise HTTPException(status_code=400, detail="Dono do pet inválido.")
    pet = Pet(**payload.model_dump())
    db.add(pet)
    db.commit()
    db.refresh(pet)
    return pet

@router.get("/pets/{owner_id}", response_model=list[PetOut])
def list_pets(owner_id: int, db: Session = Depends(get_db)):
    return list(db.scalars(select(Pet).where(Pet.owner_id == owner_id)).all())

@router.post("/walk-requests", response_model=WalkRequestOut)
def create_walk_request(payload: WalkRequestCreate, db: Session = Depends(get_db)):
    client = db.get(User, payload.client_id)
    if not client or client.role != "client":
        raise HTTPException(status_code=400, detail="Cliente inválido.")

    walker = db.get(User, payload.walker_id) if payload.walker_id else None
    status = "pending"
    expires_at = None

    if walker:
        status = "invited"
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=90)

    walk = WalkRequest(
        client_id=payload.client_id,
        walker_id=payload.walker_id,
        pet_id=payload.pet_id,
        pickup_address=payload.pickup_address,
        neighborhood=payload.neighborhood,
        city=payload.city,
        scheduled_at=payload.scheduled_at,
        duration_minutes=payload.duration_minutes,
        price=payload.price,
        notes=payload.notes,
        status=status,
        invite_expires_at=expires_at,
        payment_status="unpaid",
    )
    db.add(walk)
    db.commit()
    db.refresh(walk)

    if walker:
        redis_service.publish(f"walker:{walker.id}", {
            "type": "walk_invite",
            "request_id": walk.id,
            "expires_at": walk.invite_expires_at.isoformat() if walk.invite_expires_at else None
        })

    return walk

@router.get("/walk-requests", response_model=list[WalkRequestOut])
def list_walk_requests(user_id: int | None = None, db: Session = Depends(get_db)):
    query = select(WalkRequest)
    if user_id:
        query = query.where((WalkRequest.client_id == user_id) | (WalkRequest.walker_id == user_id))
    return list(db.scalars(query.order_by(WalkRequest.id.desc())).all())

@router.post("/walk-requests/{request_id}/accept", response_model=WalkRequestOut)
def accept_walk_request(request_id: int, payload: WalkRequestAction, db: Session = Depends(get_db)):
    walk = db.get(WalkRequest, request_id)
    if not walk:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    if walk.walker_id != payload.actor_id:
        raise HTTPException(status_code=403, detail="Somente o passeador convidado pode aceitar.")
    if walk.status not in {"invited", "pending"}:
        raise HTTPException(status_code=400, detail="Solicitação não pode mais ser aceita.")
    if walk.invite_expires_at and datetime.now(timezone.utc) > walk.invite_expires_at:
        walk.status = "expired"
        db.commit()
        raise HTTPException(status_code=400, detail="Convite expirou.")

    walk.status = "accepted"
    db.commit()
    db.refresh(walk)
    redis_service.publish(f"client:{walk.client_id}", {"type": "walk_accepted", "request_id": walk.id})
    return walk

@router.post("/walk-requests/{request_id}/decline", response_model=WalkRequestOut)
def decline_walk_request(request_id: int, payload: WalkRequestAction, db: Session = Depends(get_db)):
    walk = db.get(WalkRequest, request_id)
    if not walk:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    if walk.walker_id != payload.actor_id:
        raise HTTPException(status_code=403, detail="Somente o passeador convidado pode recusar.")
    walk.status = "declined"
    db.commit()
    db.refresh(walk)
    redis_service.publish(f"client:{walk.client_id}", {"type": "walk_declined", "request_id": walk.id})
    return walk

@router.post("/walk-requests/{request_id}/pay")
def pay_walk_request(request_id: int, payload: WalkRequestPay, db: Session = Depends(get_db)):
    walk = db.get(WalkRequest, request_id)
    if not walk:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    if walk.client_id != payload.actor_id:
        raise HTTPException(status_code=403, detail="Somente o cliente pode pagar.")
    checkout = payment_service.create_fake_checkout(request_id=walk.id, amount=payload.amount)
    walk.payment_status = "processing"
    db.commit()
    return {
        "message": "Checkout gerado.",
        "checkout": checkout
    }

@router.post("/walk-requests/{request_id}/confirm-payment", response_model=WalkRequestOut)
def confirm_payment(request_id: int, payload: WalkRequestAction, db: Session = Depends(get_db)):
    walk = db.get(WalkRequest, request_id)
    if not walk:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    if walk.client_id != payload.actor_id:
        raise HTTPException(status_code=403, detail="Somente o cliente pode confirmar.")
    walk.payment_status = "paid"
    walk.status = "paid"
    db.commit()
    db.refresh(walk)
    redis_service.publish(f"walker:{walk.walker_id}", {"type": "payment_confirmed", "request_id": walk.id})
    return walk

@router.post("/walk-requests/{request_id}/complete", response_model=WalkRequestOut)
def complete_walk(request_id: int, payload: WalkRequestAction, db: Session = Depends(get_db)):
    walk = db.get(WalkRequest, request_id)
    if not walk:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    if walk.walker_id != payload.actor_id:
        raise HTTPException(status_code=403, detail="Somente o passeador pode concluir.")
    walk.status = "completed"
    db.commit()
    db.refresh(walk)
    return walk

@router.post("/messages", response_model=MessageOut)
def send_message(payload: MessageCreate, db: Session = Depends(get_db)):
    walk = db.get(WalkRequest, payload.walk_request_id)
    if not walk:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    msg = Message(**payload.model_dump())
    db.add(msg)
    db.commit()
    db.refresh(msg)
    redis_service.publish(f"chat:{walk.id}", {
        "type": "new_message",
        "request_id": walk.id,
        "sender_id": payload.sender_id,
        "text": payload.text
    })
    return msg

@router.get("/messages/{request_id}", response_model=list[MessageOut])
def list_messages(request_id: int, db: Session = Depends(get_db)):
    return list(db.scalars(select(Message).where(Message.walk_request_id == request_id).order_by(Message.id.asc())).all())

@router.post("/maintenance/expire-invites")
def expire_invites(db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    items = list(
        db.scalars(
            select(WalkRequest).where(
                WalkRequest.status == "invited",
                WalkRequest.invite_expires_at.is_not(None)
            )
        ).all()
    )
    expired_ids = []
    for item in items:
        if item.invite_expires_at and now > item.invite_expires_at:
            item.status = "expired"
            expired_ids.append(item.id)
            redis_service.publish(f"client:{item.client_id}", {"type": "walk_expired", "request_id": item.id})
    db.commit()
    return {"expired_ids": expired_ids, "count": len(expired_ids)}
import requests
import os

@router.get("/pagamento")
def criar_pagamento():
    access_token = os.getenv("MERCADO_PAGO_ACCESS_TOKEN")

    url = "https://api.mercadopago.com/checkout/preferences"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    body = {
        "items": [
            {
                "title": "Passeio com Pet",
                "quantity": 1,
                "currency_id": "BRL",
                "unit_price": 20.0
            }
        ]
    }

    response = requests.post(url, json=body, headers=headers)

    data = response.json()

    return {
        "link_pagamento": data.get("init_point"),
        "sandbox_link": data.get("sandbox_init_point")
    }
