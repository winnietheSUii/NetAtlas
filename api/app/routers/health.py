from datetime import datetime, timezone

from fastapi import APIRouter

from app.core.config import settings
from app.core.database import db
from app.models.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Return API liveness, active operating mode, and database connectivity."""
    if settings.mock_mode:
        from app.services.mock_data import get_mock_device_summaries

        return HealthResponse(
            status="ok",
            mode="mock",
            database="mock",
            version=settings.app_version,
            device_count=len(get_mock_device_summaries()),
            timestamp=datetime.now(timezone.utc),
        )

    db_ok = await db.check_health()
    device_count = 0
    if db_ok:
        try:
            row = await db.fetch_one("SELECT COUNT(*) AS cnt FROM device")
            device_count = int(row["cnt"]) if row else 0
        except Exception:
            device_count = 0

    return HealthResponse(
        status="ok" if db_ok else "degraded",
        mode="live",
        database="connected" if db_ok else "disconnected",
        version=settings.app_version,
        device_count=device_count,
        timestamp=datetime.now(timezone.utc),
    )
