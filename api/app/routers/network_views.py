from fastapi import APIRouter, Query

from app.models.schemas import EndpointListResponse, VlanListResponse
from app.services.inventory import list_endpoints, list_vlans

router = APIRouter(tags=["network-views"])


@router.get("/endpoints", response_model=EndpointListResponse)
async def read_endpoints(
    search: str | None = Query(default=None, description="Search MAC, IP, OUI, port, or switch."),
    vlan: str | None = Query(default=None, description="Filter by VLAN ID."),
    switch_ip: str | None = Query(default=None, description="Filter by connected switch IP."),
    site_id: str = Query(default="local", description="Site ID ('local' or remote site)."),
) -> EndpointListResponse:
    """List active MAC/IP endpoint bindings across discovered switches."""
    return await list_endpoints(
        search=search,
        vlan=vlan,
        switch_ip=switch_ip,
        site_id=site_id,
    )


@router.get("/vlans", response_model=VlanListResponse)
async def read_vlans(
    site_id: str = Query(default="local", description="Site ID ('local' or remote site)."),
) -> VlanListResponse:
    """Aggregate VLAN memberships across switches in a site."""
    return await list_vlans(site_id=site_id)
