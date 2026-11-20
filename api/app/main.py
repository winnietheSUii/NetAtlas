from contextlib import asynccontextmanager
import logging
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import db
from app.routers import control_plane, devices, health, network_views, scan, topology

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Manage PostgreSQL connection pool lifecycle."""
    await db.startup()
    try:
        yield
    finally:
        await db.shutdown()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Enterprise L2/L3 network discovery and topology API backed by Netdisco.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(topology.router, prefix="/api")
app.include_router(devices.router, prefix="/api")
app.include_router(network_views.router, prefix="/api")
app.include_router(control_plane.router, prefix="/api")
app.include_router(scan.router, prefix="/api")
