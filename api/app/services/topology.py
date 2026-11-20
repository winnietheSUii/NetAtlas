from collections import defaultdict, deque
from datetime import datetime, timezone
import re
from typing import Any

from app.core.config import settings
from app.core.database import db
from app.models.schemas import (
    DeviceRole,
    TopologyEdge,
    TopologyNode,
    TopologyResponse,
    TopologySummary,
)

_PORT_PREFIX_RE = re.compile(r"^([a-zA-Z-]+)(.*)$")

_PORT_PREFIX_MAP: list[tuple[str, str]] = [
    ("hundredgigabitethernet", "hu"),
    ("hundredgige", "hu"),
    ("fortygigabitethernet", "fo"),
    ("fortygige", "fo"),
    ("twentyfivegigabitethernet", "twe"),
    ("twentyfivegige", "twe"),
    ("tengigabitethernet", "te"),
    ("tengige", "te"),
    ("gigabitethernet", "gi"),
    ("gige", "gi"),
    ("fastethernet", "fa"),
    ("port-channel", "po"),
    ("portchannel", "po"),
    ("ethernet", "et"),
    ("eth", "et"),
]

_SPEED_RE = re.compile(
    r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(tbps|gbps|mbps|kbps|bps|g|m|k)?\s*$", re.I
)

ROLE_TO_TIER: dict[DeviceRole, int] = {
    "firewall": 0,
    "router": 0,
    "core": 1,
    "distribution": 2,
    "access": 3,
    "wireless": 4,
    "unknown": 4,
}


def normalize_port_name(port: str | None) -> str:
    """Normalize vendor-specific interface prefixes for link deduplication only."""
    if not port:
        return ""
    cleaned = port.strip().lower().replace(" ", "")
    match = _PORT_PREFIX_RE.match(cleaned)
    if not match:
        return cleaned
    prefix, suffix = match.group(1), match.group(2)
    for long_prefix, short_prefix in _PORT_PREFIX_MAP:
        if prefix == long_prefix:
            return f"{short_prefix}{suffix}"
    return cleaned


def parse_speed_mbps(speed: str | None) -> tuple[str | None, int | None]:
    """Parse Netdisco speed strings or raw bps values into display text and Mbps."""
    if speed is None:
        return None, None
    raw = str(speed).strip()
    if not raw or raw.lower() in {"auto", "unknown", "none", "0"}:
        return None, None

    match = _SPEED_RE.match(raw)
    if not match:
        return raw, None

    value = float(match.group(1))
    unit = (match.group(2) or "").lower()

    if unit in {"tbps"}:
        mbps = int(round(value * 1_000_000))
    elif unit in {"gbps", "g"}:
        mbps = int(round(value * 1_000))
    elif unit in {"mbps", "m"}:
        mbps = int(round(value))
    elif unit in {"kbps", "k"}:
        mbps = max(1, int(round(value / 1_000)))
    elif unit == "bps" or unit == "":
        mbps = int(round(value / 1_000_000)) if value >= 100_000 else int(round(value))
    else:
        return raw, None

    if mbps <= 0:
        return None, None
    if mbps >= 1_000:
        gbps = mbps / 1_000
        display = f"{int(gbps)} Gbps" if gbps.is_integer() else f"{gbps:g} Gbps"
    else:
        display = f"{mbps} Mbps"
    return display, mbps


def classify_device_role(
    hostname: str,
    vendor: str | None = None,
    model: str | None = None,
    layers: str | None = None,
    uplink_count: int = 0,
    managed: bool = True,
) -> tuple[DeviceRole, int]:
    """Infer architectural network role and hierarchy tier from device metadata."""
    if not managed:
        return "unknown", 4

    text = " ".join(part for part in (hostname, vendor or "", model or "") if part).lower()

    if any(
        tok in text
        for tok in ("firewall", "palo alto", "pa-", "forti", "asa", "firepower", "fpr", "srx", "fw-")
    ):
        return "firewall", 0
    if any(tok in text for tok in ("ap-", "wap", "wireless", "c91", "air-", "c9800", "unifi")):
        return "wireless", 4
    if any(tok in text for tok in ("core", "c96", "n9k", "nexus 9", "spine")):
        return "core", 1
    if any(tok in text for tok in ("dist", "agg", "c95", "7280", "leaf")):
        return "distribution", 2
    if any(
        tok in text
        for tok in ("acc", "c93", "c92", "c2960", "ex43", "ex34", "6300", "2930", "7050")
    ):
        return "access", 3
    if any(tok in text for tok in ("rtr", "router", "isr", "asr", "mx", "crs", "gw-")):
        return "router", 0

    if layers and len(layers) == 8 and set(layers) <= {"0", "1"}:
        # Netdisco stores SNMP sysServices MSB-first: index 5 = L3, index 6 = L2.
        has_l3 = layers[5] == "1"
        has_l2 = layers[6] == "1"
        if has_l3 and not has_l2:
            return "router", 0
        if has_l3 and has_l2:
            return ("distribution", 2) if uplink_count >= 2 else ("access", 3)
        if has_l2:
            return "access", 3

    return "access", 3


def _merge_status(current: str, incoming: str | None) -> str:
    if not incoming:
        return current
    norm = incoming.strip().lower()
    if norm == "down" or current == "down":
        return "down"
    if norm == "up" or current == "up":
        return "up"
    return "unknown"


def _orient_endpoints(
    src_ip: str,
    src_port: str,
    dst_ip: str,
    dst_port: str,
    node_tiers: dict[str, int],
) -> tuple[str, str, str, str]:
    src_tier = node_tiers.get(src_ip, 4)
    dst_tier = node_tiers.get(dst_ip, 4)
    if (src_tier, src_ip) <= (dst_tier, dst_ip):
        return src_ip, src_port, dst_ip, dst_port
    return dst_ip, dst_port, src_ip, src_port


def deduplicate_links(
    raw_links: list[dict[str, Any]],
    node_tiers: dict[str, int],
    managed_ips: set[str] | None = None,
) -> list[TopologyEdge]:
    """Deduplicate bidirectional switch-to-switch observations while preserving parallel cables."""
    exact_entries: dict[tuple[Any, ...], dict[str, Any]] = {}
    matched_endpoints: set[tuple[str, str]] = set()
    matched_device_pairs: set[tuple[str, str]] = set()
    half_rows: list[dict[str, Any]] = []

    for row in raw_links:
        local_ip = str(row.get("local_ip") or "").strip()
        remote_ip = str(row.get("remote_ip") or "").strip()
        local_port = str(row.get("local_port") or "").strip()
        remote_port = str(row.get("remote_port") or "").strip()

        if not local_ip or not remote_ip or local_ip == remote_ip or not local_port:
            continue

        if not remote_port:
            half_rows.append(row)
            continue

        ep_a = (local_ip, normalize_port_name(local_port))
        ep_b = (remote_ip, normalize_port_name(remote_port))
        pair_key = ("exact", tuple(sorted([ep_a, ep_b])))

        matched_endpoints.add(ep_a)
        matched_endpoints.add(ep_b)
        matched_device_pairs.add((min(local_ip, remote_ip), max(local_ip, remote_ip)))

        source, source_port, target, target_port = _orient_endpoints(
            local_ip, local_port, remote_ip, remote_port, node_tiers
        )
        speed_disp, speed_mbps = parse_speed_mbps(row.get("speed"))
        up_state = _merge_status("unknown", row.get("up"))

        if pair_key not in exact_entries:
            exact_entries[pair_key] = {
                "source": source,
                "target": target,
                "source_port": source_port,
                "target_port": target_port,
                "speed": speed_disp,
                "speed_mbps": speed_mbps,
                "status": up_state,
                "protocol": str(row.get("remote_type") or "CDP/LLDP"),
            }
        else:
            existing = exact_entries[pair_key]
            existing["status"] = _merge_status(existing["status"], row.get("up"))
            if existing["speed_mbps"] is None and speed_mbps is not None:
                existing["speed"] = speed_disp
                existing["speed_mbps"] = speed_mbps

    for row in half_rows:
        local_ip = str(row["local_ip"]).strip()
        remote_ip = str(row["remote_ip"]).strip()
        local_port = str(row["local_port"]).strip()
        norm_local = normalize_port_name(local_port)
        dev_pair = (min(local_ip, remote_ip), max(local_ip, remote_ip))

        if (local_ip, norm_local) in matched_endpoints and dev_pair in matched_device_pairs:
            continue

        half_key = ("half", dev_pair, norm_local)
        source, source_port, target, target_port = _orient_endpoints(
            local_ip, local_port, remote_ip, "unknown", node_tiers
        )
        speed_disp, speed_mbps = parse_speed_mbps(row.get("speed"))
        up_state = _merge_status("unknown", row.get("up"))

        if half_key not in exact_entries:
            exact_entries[half_key] = {
                "source": source,
                "target": target,
                "source_port": source_port,
                "target_port": target_port,
                "speed": speed_disp,
                "speed_mbps": speed_mbps,
                "status": up_state,
                "protocol": str(row.get("remote_type") or "CDP/LLDP"),
            }

    grouped_by_pair: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for item in exact_entries.values():
        grouped_by_pair[(item["source"], item["target"])].append(item)

    edges: list[TopologyEdge] = []
    for (source, target), group in sorted(grouped_by_pair.items()):
        group.sort(key=lambda e: (e["source_port"], e["target_port"]))
        total = len(group)
        is_unmanaged = managed_ips is not None and (
            source not in managed_ips or target not in managed_ips
        )
        for idx, item in enumerate(group):
            edge_id = f"{source}:{item['source_port']}--{target}:{item['target_port']}"
            if total > 1:
                edge_id = f"{edge_id}#{idx}"
            edges.append(
                TopologyEdge(
                    id=edge_id,
                    source=source,
                    target=target,
                    source_port=item["source_port"],
                    target_port=item["target_port"],
                    speed=item["speed"],
                    speed_mbps=item["speed_mbps"],
                    link_type="unmanaged" if is_unmanaged else "uplink",
                    status=item["status"] if item["status"] in {"up", "down"} else "unknown",
                    protocol=item["protocol"],
                    parallel_index=idx,
                    parallel_total=total,
                )
            )

    return edges


def apply_graph_hierarchy(
    nodes: list[TopologyNode],
    edges: list[TopologyEdge],
    overrides: dict[str, dict[str, Any]] | None = None,
) -> tuple[list[TopologyNode], list[TopologyEdge]]:
    """Apply saved role/root overrides and infer standard graph hierarchy when core isn't named."""
    overrides = overrides or {}
    by_id: dict[str, TopologyNode] = {}
    has_explicit_role: set[str] = set()

    for node in nodes:
        ov = overrides.get(node.ip)
        if ov:
            if ov.get("pos_x") is not None:
                node.pos_x = float(ov["pos_x"])
            if ov.get("pos_y") is not None:
                node.pos_y = float(ov["pos_y"])
            if ov.get("is_root"):
                node.is_root = True
            role_ov = ov.get("role_override")
            if role_ov in ROLE_TO_TIER:
                node.role_override = role_ov
                node.role = role_ov
                node.tier = ROLE_TO_TIER[role_ov]
                has_explicit_role.add(node.id)
        by_id[node.id] = node

    adj: dict[str, set[str]] = defaultdict(set)
    max_speed: dict[str, int] = defaultdict(int)
    for edge in edges:
        adj[edge.source].add(edge.target)
        adj[edge.target].add(edge.source)
        if edge.speed_mbps:
            max_speed[edge.source] = max(max_speed[edge.source], edge.speed_mbps)
            max_speed[edge.target] = max(max_speed[edge.target], edge.speed_mbps)

    pinned_roots = [n for n in nodes if n.is_root]

    if pinned_roots:
        root = pinned_roots[0]
        if root.id not in has_explicit_role and root.role not in ("firewall", "router", "core"):
            root.role = "core"
            root.tier = 1

        root_tier = 0 if root.role in ("firewall", "router") else 1
        dist: dict[str, int] = {root.id: 0}
        queue: deque[str] = deque([root.id])
        while queue:
            cur = queue.popleft()
            for nxt in sorted(adj.get(cur, set())):
                if nxt not in dist:
                    dist[nxt] = dist[cur] + 1
                    queue.append(nxt)

        for node in nodes:
            if node.id == root.id or node.id in has_explicit_role:
                continue
            if not node.managed or node.role in ("wireless", "unknown"):
                node.tier = 4
                continue
            if node.role in ("firewall", "router"):
                node.tier = 0
                continue
            hop = dist.get(node.id, 3)
            if root_tier == 0:
                if hop == 1:
                    node.role = "core"
                    node.tier = 1
                elif hop == 2:
                    node.role = "distribution"
                    node.tier = 2
                else:
                    node.role = "access"
                    node.tier = 3
            else:
                if hop == 1:
                    has_downstream = any(
                        dist.get(nb, 0) > hop
                        and by_id.get(nb) is not None
                        and by_id[nb].role not in ("wireless", "unknown")
                        for nb in adj.get(node.id, set())
                    )
                    node.role = "distribution" if has_downstream else "access"
                    node.tier = 2 if has_downstream else 3
                else:
                    node.role = "access"
                    node.tier = 3

    else:
        has_core = any(n.managed and n.role == "core" for n in nodes)
        candidates = [
            n
            for n in nodes
            if n.managed and n.role not in ("firewall", "router", "wireless", "unknown")
        ]
        if not has_core and len(candidates) >= 2:
            # Promote highest-centrality switch (degree, speed, port count) rather than seed IP
            candidates.sort(
                key=lambda n: (
                    1 if n.role == "distribution" else 0,
                    len(adj.get(n.id, set())),
                    max_speed.get(n.id, 0),
                    n.uplink_count,
                    n.port_count,
                ),
                reverse=True,
            )
            core = candidates[0]
            if core.id not in has_explicit_role:
                core.role = "core"
                core.tier = 1

            dist = {core.id: 0}
            queue = deque([core.id])
            while queue:
                cur = queue.popleft()
                for nxt in sorted(adj.get(cur, set())):
                    if nxt not in dist:
                        dist[nxt] = dist[cur] + 1
                        queue.append(nxt)

            for node in nodes:
                if node.id == core.id or node.id in has_explicit_role:
                    continue
                if not node.managed or node.role in ("firewall", "router", "wireless", "unknown"):
                    continue
                hop = dist.get(node.id, 2)
                if hop == 1:
                    has_downstream = any(
                        dist.get(nb, 0) > 1
                        and by_id.get(nb) is not None
                        and by_id[nb].role not in ("wireless", "unknown")
                        for nb in adj.get(node.id, set())
                    )
                    node.role = "distribution" if has_downstream else "access"
                    node.tier = 2 if has_downstream else 3
                else:
                    node.role = "access"
                    node.tier = 3

    final_tiers = {n.id: n.tier for n in nodes}
    reoriented_edges: list[TopologyEdge] = []
    for edge in edges:
        s_tier = final_tiers.get(edge.source, 4)
        t_tier = final_tiers.get(edge.target, 4)
        if (s_tier, edge.source) <= (t_tier, edge.target):
            reoriented_edges.append(edge)
        else:
            reoriented_edges.append(
                edge.model_copy(
                    update={
                        "source": edge.target,
                        "target": edge.source,
                        "source_port": edge.target_port,
                        "target_port": edge.source_port,
                    }
                )
            )

    return nodes, reoriented_edges


def _pick_hostname(dns: str | None, name: str | None, ip: str) -> str:
    candidate = (name or dns or ip).strip()
    if "." in candidate and not candidate.replace(".", "").isdigit():
        return candidate.split(".")[0]
    return candidate


async def get_topology(
    include_unmanaged: bool = True,
    site_id: str = "local",
) -> TopologyResponse:
    """Build normalized topology nodes and deduplicated edges for a site."""
    from app.services.control_plane import get_node_overrides, get_site_snapshot

    overrides = await get_node_overrides(site_id)

    if site_id != "local":
        snapshot = await get_site_snapshot(site_id)
        mode_str = "mock" if settings.mock_mode else "live"
        if snapshot is None:
            return TopologyResponse(
                nodes=[],
                edges=[],
                summary=TopologySummary(
                    total_devices=0,
                    managed_devices=0,
                    unmanaged_neighbors=0,
                    total_links=0,
                    total_endpoints=0,
                    vendors={},
                    roles={},
                    generated_at=datetime.now(timezone.utc),
                    mode=mode_str,
                ),
            )

        raw_devices = snapshot.get("devices", [])
        raw_links = snapshot.get("raw_links", [])
        nodes: list[TopologyNode] = []
        node_tiers: dict[str, int] = {}
        managed_ips: set[str] = set()
        total_endpoints = 0

        for d in raw_devices:
            ip = d["ip"]
            managed_ips.add(ip)
            node_tiers[ip] = int(d.get("tier", 3))
            ep_cnt = int(d.get("endpoint_count") or 0)
            total_endpoints += ep_cnt
            nodes.append(
                TopologyNode(
                    id=ip,
                    ip=ip,
                    hostname=d["hostname"],
                    vendor=d.get("vendor"),
                    model=d.get("model"),
                    os=d.get("os"),
                    role=d.get("role", "access"),
                    tier=int(d.get("tier", 3)),
                    location=d.get("location"),
                    managed=True,
                    port_count=int(d.get("port_count") or 0),
                    active_port_count=int(d.get("active_port_count") or 0),
                    uplink_count=int(d.get("uplink_count") or 0),
                    endpoint_count=ep_cnt,
                    last_discover=d.get("last_discover"),
                )
            )

        unmanaged_ips: dict[str, str] = {}
        filtered_links: list[dict[str, Any]] = []
        for row in raw_links:
            remote_ip = str(row.get("remote_ip") or "").strip()
            if not remote_ip:
                continue
            if remote_ip not in managed_ips:
                if not include_unmanaged:
                    continue
                unmanaged_ips.setdefault(remote_ip, str(row.get("remote_id") or remote_ip))
            filtered_links.append(row)

        for uip, remote_id in sorted(unmanaged_ips.items()):
            node_tiers[uip] = 4
            nodes.append(
                TopologyNode(
                    id=uip,
                    ip=uip,
                    hostname=_pick_hostname(None, remote_id, uip),
                    model="Unmanaged Neighbor",
                    role="unknown",
                    tier=4,
                    managed=False,
                )
            )

        edges = deduplicate_links(filtered_links, node_tiers, managed_ips=managed_ips)
        nodes, edges = apply_graph_hierarchy(nodes, edges, overrides)

        vendor_counts: dict[str, int] = defaultdict(int)
        role_counts: dict[str, int] = defaultdict(int)
        for n in nodes:
            if n.managed:
                vendor_counts[n.vendor or "Unknown"] += 1
            role_counts[n.role] += 1

        return TopologyResponse(
            nodes=nodes,
            edges=edges,
            summary=TopologySummary(
                total_devices=len(nodes),
                managed_devices=len(managed_ips),
                unmanaged_neighbors=len(unmanaged_ips),
                total_links=len(edges),
                total_endpoints=total_endpoints,
                vendors=dict(sorted(vendor_counts.items())),
                roles=dict(sorted(role_counts.items())),
                generated_at=datetime.now(timezone.utc),
                mode=mode_str,
            ),
        )

    if settings.mock_mode:
        from app.services.mock_data import build_mock_topology

        topo = build_mock_topology(include_unmanaged=include_unmanaged)
        nodes, edges = apply_graph_hierarchy(topo.nodes, topo.edges, overrides)
        role_counts_mock: dict[str, int] = defaultdict(int)
        for n in nodes:
            role_counts_mock[n.role] += 1
        topo.nodes = nodes
        topo.edges = edges
        topo.summary.roles = dict(sorted(role_counts_mock.items()))
        return topo

    device_rows = await db.fetch_all(
        """
        SELECT
            host(d.ip) AS ip,
            d.name,
            d.dns,
            d.vendor,
            d.model,
            d.os,
            d.layers,
            d.location,
            d.last_discover,
            COALESCE(p.port_count, 0) AS port_count,
            COALESCE(p.active_port_count, 0) AS active_port_count,
            COALESCE(p.uplink_count, 0) AS uplink_count,
            COALESCE(n.endpoint_count, 0) AS endpoint_count
        FROM device d
        LEFT JOIN (
            SELECT
                ip,
                COUNT(*) AS port_count,
                COUNT(*) FILTER (WHERE up = 'up') AS active_port_count,
                COUNT(*) FILTER (WHERE is_uplink IS TRUE OR remote_ip IS NOT NULL) AS uplink_count
            FROM device_port
            GROUP BY ip
        ) p ON p.ip = d.ip
        LEFT JOIN (
            SELECT
                switch AS ip,
                COUNT(*) AS endpoint_count
            FROM node
            WHERE active IS TRUE
            GROUP BY switch
        ) n ON n.ip = d.ip
        ORDER BY d.name NULLS LAST, d.ip
        """
    )

    link_rows = await db.fetch_all(
        """
        SELECT
            host(dp.ip) AS local_ip,
            dp.port AS local_port,
            COALESCE(host(dip.ip), host(dp.remote_ip)) AS remote_ip,
            dp.remote_port,
            dp.remote_id,
            dp.remote_type,
            dp.speed,
            dp.up,
            dp.is_uplink
        FROM device_port dp
        LEFT JOIN device_ip dip ON dp.remote_ip = dip.alias
        WHERE dp.remote_ip IS NOT NULL
        """
    )

    nodes = []
    node_tiers = {}
    managed_ips = set()
    vendor_counts = defaultdict(int)
    role_counts = defaultdict(int)
    total_endpoints = 0

    for row in device_rows:
        ip = row["ip"]
        hostname = _pick_hostname(row.get("dns"), row.get("name"), ip)
        role, tier = classify_device_role(
            hostname=hostname,
            vendor=row.get("vendor"),
            model=row.get("model"),
            layers=row.get("layers"),
            uplink_count=int(row.get("uplink_count") or 0),
            managed=True,
        )
        managed_ips.add(ip)
        node_tiers[ip] = tier
        vendor_counts[row.get("vendor") or "Unknown"] += 1
        endpoints = int(row.get("endpoint_count") or 0)
        total_endpoints += endpoints

        nodes.append(
            TopologyNode(
                id=ip,
                ip=ip,
                hostname=hostname,
                vendor=row.get("vendor"),
                model=row.get("model"),
                os=row.get("os"),
                role=role,
                tier=tier,
                location=row.get("location"),
                managed=True,
                port_count=int(row.get("port_count") or 0),
                active_port_count=int(row.get("active_port_count") or 0),
                uplink_count=int(row.get("uplink_count") or 0),
                endpoint_count=endpoints,
                last_discover=row.get("last_discover"),
            )
        )

    unmanaged_ips = {}
    filtered_links = []
    for row in link_rows:
        remote_ip = str(row.get("remote_ip") or "").strip()
        if not remote_ip:
            continue
        if remote_ip not in managed_ips:
            if not include_unmanaged:
                continue
            unmanaged_ips.setdefault(remote_ip, str(row.get("remote_id") or remote_ip))
        filtered_links.append(row)

    for uip, remote_id in sorted(unmanaged_ips.items()):
        node_tiers[uip] = 4
        nodes.append(
            TopologyNode(
                id=uip,
                ip=uip,
                hostname=_pick_hostname(None, remote_id, uip),
                vendor=None,
                model="Unmanaged Neighbor",
                os=None,
                role="unknown",
                tier=4,
                location=None,
                managed=False,
                port_count=0,
                active_port_count=0,
                uplink_count=0,
                endpoint_count=0,
                last_discover=None,
            )
        )

    edges = deduplicate_links(filtered_links, node_tiers, managed_ips=managed_ips)
    nodes, edges = apply_graph_hierarchy(nodes, edges, overrides)

    for n in nodes:
        role_counts[n.role] += 1

    summary = TopologySummary(
        total_devices=len(nodes),
        managed_devices=len(managed_ips),
        unmanaged_neighbors=len(unmanaged_ips),
        total_links=len(edges),
        total_endpoints=total_endpoints,
        vendors=dict(sorted(vendor_counts.items())),
        roles=dict(sorted(role_counts.items())),
        generated_at=datetime.now(timezone.utc),
        mode="live",
    )
    return TopologyResponse(nodes=nodes, edges=edges, summary=summary)
