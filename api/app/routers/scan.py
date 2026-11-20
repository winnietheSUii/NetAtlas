from fastapi import APIRouter, Query, status

from app.models.schemas import ScanJobsResponse, ScanRequest, ScanResponse
from app.services.scanner import enqueue_scan, list_scan_jobs

router = APIRouter(prefix="/scan", tags=["scan"])


@router.post("", response_model=ScanResponse, status_code=status.HTTP_202_ACCEPTED)
async def trigger_scan(payload: ScanRequest) -> ScanResponse:
    """Enqueue discover, macsuck, and/or arpnip jobs for a target switch IP."""
    return await enqueue_scan(payload)


@router.get("/jobs", response_model=ScanJobsResponse)
async def read_scan_jobs(
    limit: int = Query(default=50, ge=1, le=200, description="Maximum number of recent jobs."),
) -> ScanJobsResponse:
    """List recent Netdisco discovery jobs from the admin queue."""
    return await list_scan_jobs(limit=limit)
