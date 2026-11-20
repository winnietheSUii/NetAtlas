from fastapi import APIRouter, Query

from app.models.schemas import StatusSummaryResponse
from app.services.poller import status_poller

router = APIRouter(prefix="/status", tags=["status"])


@router.get("", response_model=StatusSummaryResponse)
async def read_status_summary(
    site_id: str = Query(default="local", description="Site ID ('local' or remote site)."),
) -> StatusSummaryResponse:
    """Return latest ICMP reachability and latency status for devices in a site."""
    return await status_poller.get_status_summary(site_id=site_id)


@router.post("/poll", response_model=StatusSummaryResponse)
async def trigger_status_poll() -> StatusSummaryResponse:
    """Run an immediate ICMP reachability & latency sweep across local devices."""
    return await status_poller.poll_once()
