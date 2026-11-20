from fastapi import APIRouter, Query

from app.models.schemas import DeviceListResponse, DevicePortsResponse
from app.services.inventory import get_device_ports, list_devices

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("", response_model=DeviceListResponse)
async def read_devices(
    search: str | None = Query(
        default=None,
        description="Filter by hostname, IP, vendor, model, serial, or location.",
    ),
    vendor: str | None = Query(default=None, description="Filter by exact vendor name."),
    role: str | None = Query(default=None, description="Filter by inferred network role."),
    site_id: str = Query(default="local", description="Site ID ('local' or remote site)."),
) -> DeviceListResponse:
    """List discovered network devices with optional filters."""
    return await list_devices(search=search, vendor=vendor, role=role, site_id=site_id)


@router.get("/{ip}/ports", response_model=DevicePortsResponse)
async def read_device_ports(
    ip: str,
    site_id: str = Query(default="local", description="Site ID ('local' or remote site)."),
) -> DevicePortsResponse:
    """Inspect interfaces, VLAN memberships, uplinks, and connected endpoints for a device."""
    return await get_device_ports(ip=ip, site_id=site_id)
