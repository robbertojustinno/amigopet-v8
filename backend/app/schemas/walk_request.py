from pydantic import BaseModel
from typing import Optional

class WalkRequestCreate(BaseModel):
    client_id: int
    walker_id: Optional[int] = None
    pet_id: Optional[int] = None
    pickup_address: str
    neighborhood: Optional[str] = None
    city: Optional[str] = None
    scheduled_at: Optional[str] = None
    duration_minutes: int = 30
    price: float = 0
    notes: Optional[str] = None

class WalkRequestAction(BaseModel):
    actor_id: int

class WalkRequestPay(BaseModel):
    actor_id: int
    amount: float

class WalkRequestOut(BaseModel):
    id: int
    client_id: int
    walker_id: Optional[int] = None
    pet_id: Optional[int] = None
    pickup_address: str
    neighborhood: Optional[str] = None
    city: Optional[str] = None
    scheduled_at: Optional[str] = None
    duration_minutes: int
    price: float
    status: str
    payment_status: str
    notes: Optional[str] = None

    class Config:
        from_attributes = True
