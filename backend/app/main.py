from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from app.api.routes import router
from app.core.config import settings
from app.db.session import Base, engine

# =========================
# 🚀 CRIA APP PRIMEIRO
# =========================
app = FastAPI(title=settings.APP_NAME, version="8.0.0")

# =========================
# 🗄️ BANCO
# =========================
Base.metadata.create_all(bind=engine)

# =========================
# 🌐 CORS
# =========================
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# 📁 STORAGE
# =========================
storage_dir = Path("storage")
storage_dir.mkdir(exist_ok=True)

app.mount("/storage", StaticFiles(directory=str(storage_dir)), name="storage")

# =========================
# 🔌 API
# =========================
app.include_router(router, prefix="/api")

# =========================
# 🎨 FRONTEND
# =========================
BASE_DIR = Path(__file__).resolve().parent.parent.parent
frontend_dir = BASE_DIR / "frontend"

if frontend_dir.exists():

    @app.get("/", include_in_schema=False)
    async def serve_frontend():
        return FileResponse(frontend_dir / "index.html")

    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
