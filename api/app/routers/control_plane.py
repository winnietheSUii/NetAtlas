from fastapi import APIRouter, Header, status

from app.models.schemas import (
    AgentListResponse,
    AgentRegisterRequest,
    AgentRegisterResponse,
    IngestResponse,
    IngestSnapshotPayload,
    SiteCreateRequest,
    SiteListResponse,
    SiteSummary,
)
from app.services.control_plane import (
    create_site,
    ingest_snapshot,
    list_agents,
    list_sites,
    register_agent,
)

router = APIRouter(tags=["control-plane"])


@router.get("/sites", response_model=SiteListResponse)
async def read_sites() -> SiteListResponse:
    """List local and registered remote network sites."""
    return await list_sites()


@router.post("/sites", response_model=SiteSummary, status_code=status.HTTP_201_CREATED)
async def create_new_site(payload: SiteCreateRequest) -> SiteSummary:
    """Create a remote site for multi-site collector agents."""
    return await create_site(payload)


@router.get("/agents", response_model=AgentListResponse)
async def read_agents() -> AgentListResponse:
    """List built-in local collector and registered remote agents."""
    return await list_agents()


@router.post(
    "/agents/register",
    response_model=AgentRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_new_agent(payload: AgentRegisterRequest) -> AgentRegisterResponse:
    """Register a remote site collector agent and issue its ingest token."""
    return await register_agent(payload)


@router.post(
    "/v1/ingest",
    response_model=IngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_agent_snapshot(
    payload: IngestSnapshotPayload,
    x_agent_token: str | None = Header(default=None, alias="X-Agent-Token"),
) -> IngestResponse:
    """Receive normalized discovery snapshots from remote site agents."""
    return await ingest_snapshot(payload=payload, token=x_agent_token)
