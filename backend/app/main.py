"""FastAPI application factory — Tradevelix."""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.config import settings
from app.database import init_db
from app.api.v1.sync import router as sync_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.auth import router as auth_router
from app.api.v1.ownership import router as ownership_router
from app.api.v1.alerts import router as alerts_router
from app.api.v1.admin_credentials import router as admin_credentials_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Tradevelix starting up...")
    logger.info(f"   Environment: {settings.ENVIRONMENT}")
    logger.info(f"   Watchlist: {settings.watchlist_list}")
    await init_db()
    logger.info("   Database tables created/verified")
    yield
    logger.info("Tradevelix shutting down...")


app = FastAPI(
    title="Tradevelix API",
    description="IDX Smart Money Tracker — Three Doors Analysis",
    version="3.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/docs")


@app.get("/api/v1/health")
async def health():
    return {
        "status": "ok",
        "version": "3.0.0",
        "environment": settings.ENVIRONMENT,
        "watchlist": settings.watchlist_list,
    }

app.include_router(auth_router,      prefix="/api/v1")
app.include_router(sync_router,      prefix="/api/v1")
app.include_router(dashboard_router, prefix="/api/v1")
app.include_router(ownership_router, prefix="/api/v1")
app.include_router(alerts_router,    prefix="/api/v1")
app.include_router(admin_credentials_router, prefix="/api/v1")
