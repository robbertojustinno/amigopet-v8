from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from app.api.routes import router
from app.core.config import settings
from app.db.session import Base, engine

Base.metadata.create_all(bind=engine)

app = FastAPI(title=settings.APP_NAME, version="8.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

storage_dir = Path("storage")
storage_dir.mkdir(exist_ok=True)

app.mount("/storage", StaticFiles(directory=str(storage_dir)), name="storage")
app.include_router(router, prefix="/api")

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
def serve_frontend():
    return FileResponse(FRONTEND_DIR / "index.html")

if frontend_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dir)), name="frontend-assets")

    @app.get("/", include_in_schema=False)
    async def serve_frontend_index():
        return FileResponse(frontend_dir / "index.html")

    @app.get("/styles.css", include_in_schema=False)
    async def serve_frontend_styles():
        return FileResponse(frontend_dir / "styles.css")

    @app.get("/app.js", include_in_schema=False)
    async def serve_frontend_app_js():
        return FileResponse(frontend_dir / "app.js")
