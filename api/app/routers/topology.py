from typing import Any

from fastapi import APIRouter, Query

from app.models.schemas import BatchLayoutRequest, NodeOverrideRequest, TopologyResponse
from app.services.control_plane import (
    reset_site_layout,
    save_batch_layout,
    upsert_node_override,
)
from app.services.topology import get_topology

router = APIRouter(tags=["topology"])


@router.get("/topology", response_model=TopologyResponse)
async def read_topology(
    include_unmanaged: bool = Query(
        default=True,
        description="Include unmanaged CDP/LLDP neighbor devices not yet polled via SNMP.",
    ),
    site_id: str = Query(
        default="local",
        description="Site ID to display ('local' or registered remote site).",
    ),
) -> TopologyResponse:
    """Return normalized network devices and deduplicated L2/L3 links."""
    return await get_topology(include_unmanaged=include_unmanaged, site_id=site_id)


@router.put("/topology/overrides/{ip}")
async def update_node_override(
    ip: str,
    payload: NodeOverrideRequest,
    site_id: str = Query(default="local"),
) -> dict[str, Any]:
    """Pin/unpin a node as topology root, override its role, or update position."""
    updated = await upsert_node_override(site_id=site_id, ip=ip, req=payload)
    return {"status": "ok", "site_id": site_id, "override": updated}


@router.post("/topology/layout")
async def save_topology_layout(payload: BatchLayoutRequest) -> dict[str, Any]:
    """Persist node canvas positions for a site."""
    count = await save_batch_layout(site_id=payload.site_id, positions=payload.positions)
    return {"status": "ok", "site_id": payload.site_id, "saved": count}


@router.delete("/topology/layout")
async def clear_topology_layout(
    site_id: str = Query(default="local"),
) -> dict[str, Any]:
    """Reset saved node canvas coordinates back to automatic graph layout."""
    await reset_site_layout(site_id=site_id)
    return {"status": "ok", "site_id": site_id}
