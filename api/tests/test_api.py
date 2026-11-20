import os

os.environ["MOCK_MODE"] = "true"

from fastapi.testclient import TestClient

from app.main import app
from app.models.schemas import TopologyEdge, TopologyNode
from app.services.topology import (
    apply_graph_hierarchy,
    classify_device_role,
    deduplicate_links,
    normalize_port_name,
    parse_speed_mbps,
)

client = TestClient(app)


def test_health_mock_mode() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["mode"] == "mock"
    assert payload["database"] == "mock"
    assert payload["device_count"] == 10


def test_topology_nodes_and_deduplicated_parallel_links() -> None:
    response = client.get("/api/topology")
    assert response.status_code == 200
    payload = response.json()

    nodes = payload["nodes"]
    edges = payload["edges"]
    summary = payload["summary"]

    assert len(nodes) == 10
    assert summary["total_devices"] == 10
    assert summary["mode"] == "mock"
    assert len(edges) == 13

    core_peer_edges = [
        edge
        for edge in edges
        if {edge["source"], edge["target"]} == {"10.10.0.1", "10.10.0.2"}
    ]
    assert len(core_peer_edges) == 2
    assert all(edge["parallel_total"] == 2 for edge in core_peer_edges)
    assert {edge["parallel_index"] for edge in core_peer_edges} == {0, 1}
    assert all(edge["speed_mbps"] == 100_000 for edge in core_peer_edges)


def test_devices_search_and_filters() -> None:
    all_resp = client.get("/api/devices")
    assert all_resp.status_code == 200
    assert all_resp.json()["total"] == 10

    arista_resp = client.get("/api/devices", params={"search": "arista"})
    assert arista_resp.status_code == 200
    assert arista_resp.json()["total"] == 2

    cisco_core_resp = client.get(
        "/api/devices", params={"vendor": "Cisco", "role": "core"}
    )
    assert cisco_core_resp.status_code == 200
    assert cisco_core_resp.json()["total"] == 2


def test_device_ports_detail_and_error_cases() -> None:
    ok_resp = client.get("/api/devices/10.10.11.1/ports")
    assert ok_resp.status_code == 200
    data = ok_resp.json()
    assert data["device"]["hostname"] == "acc-fl1-01"
    assert data["total_ports"] > 0
    assert data["total_endpoints"] == 4

    port_112 = next(p for p in data["ports"] if p["port"] == "1/1/2")
    assert len(port_112["endpoints"]) == 2
    assert {v["vlan"] for v in port_112["vlans"]} == {10, 20}

    not_found = client.get("/api/devices/192.0.2.99/ports")
    assert not_found.status_code == 404

    invalid_ip = client.get("/api/devices/not-an-ip/ports")
    assert invalid_ip.status_code == 400


def test_scan_enqueue_validation_and_job_listing() -> None:
    bad_resp = client.post(
        "/api/scan",
        json={"target_ip": "999.999.1.1", "actions": ["discover"]},
    )
    assert bad_resp.status_code == 422

    ok_resp = client.post(
        "/api/scan",
        json={"target_ip": "10.10.0.1", "actions": ["discover", "macsuck", "arpnip"]},
    )
    assert ok_resp.status_code == 202
    queued = ok_resp.json()["queued_jobs"]
    assert len(queued) == 3
    assert [j["action"] for j in queued] == ["discover", "macsuck", "arpnip"]

    jobs_resp = client.get("/api/scan/jobs")
    assert jobs_resp.status_code == 200
    jobs_payload = jobs_resp.json()
    queued_ids = {j["job_id"] for j in queued}
    listed_ids = {j["job_id"] for j in jobs_payload["jobs"]}
    assert queued_ids.issubset(listed_ids)


def test_deduplicate_links_short_long_names_and_parallel_cables() -> None:
    node_tiers = {"10.0.0.1": 1, "10.0.0.2": 2}
    raw_links = [
        {
            "local_ip": "10.0.0.1",
            "local_port": "Te1/0/1",
            "remote_ip": "10.0.0.2",
            "remote_port": "GigabitEthernet1/0/49",
            "speed": "10 Gbps",
            "up": "up",
            "remote_type": "CDP",
        },
        {
            "local_ip": "10.0.0.2",
            "local_port": "Gi1/0/49",
            "remote_ip": "10.0.0.1",
            "remote_port": "TenGigabitEthernet1/0/1",
            "speed": "10 Gbps",
            "up": "up",
            "remote_type": "CDP",
        },
        {
            "local_ip": "10.0.0.1",
            "local_port": "Te1/0/2",
            "remote_ip": "10.0.0.2",
            "remote_port": "Gi1/0/50",
            "speed": "10000000000",
            "up": "up",
            "remote_type": "CDP",
        },
    ]

    edges = deduplicate_links(raw_links, node_tiers, managed_ips={"10.0.0.1", "10.0.0.2"})
    assert len(edges) == 2
    assert all(e.source == "10.0.0.1" and e.target == "10.0.0.2" for e in edges)
    assert all(e.parallel_total == 2 for e in edges)
    assert [e.parallel_index for e in edges] == [0, 1]


def test_parse_speed_and_normalization_helpers() -> None:
    assert normalize_port_name("GigabitEthernet1/0/24") == "gi1/0/24"
    assert normalize_port_name("TenGigabitEthernet1/1/1") == "te1/1/1"
    assert parse_speed_mbps("100 Gbps") == ("100 Gbps", 100_000)
    assert parse_speed_mbps("2.5 Gbps") == ("2.5 Gbps", 2_500)
    assert parse_speed_mbps("1000000000") == ("1 Gbps", 1_000)
    assert parse_speed_mbps("auto") == (None, None)

    assert classify_device_role("core-sw-01", "Cisco", "C9606R") == ("core", 1)
    assert classify_device_role("fw-edge-01", "Palo Alto", "PA-3260") == ("firewall", 0)
    assert classify_device_role("sw-unknown", None, None, layers="00000110", uplink_count=2) == (
        "distribution",
        2,
    )


def test_apply_graph_hierarchy_promotes_central_hub_and_supports_root_pin() -> None:
    nodes = [
        TopologyNode(id="10.0.0.10", ip="10.0.0.10", hostname="sw-hub", role="access", tier=3, port_count=48),
        TopologyNode(id="10.0.0.11", ip="10.0.0.11", hostname="sw-bldg1", role="access", tier=3, port_count=24),
        TopologyNode(id="10.0.0.12", ip="10.0.0.12", hostname="sw-bldg2", role="access", tier=3, port_count=24),
        TopologyNode(id="10.0.0.21", ip="10.0.0.21", hostname="sw-leaf1", role="access", tier=3, port_count=24),
    ]
    edges = [
        TopologyEdge(id="e1", source="10.0.0.10", target="10.0.0.11", source_port="Te1/1", target_port="Te1/1", speed_mbps=10000),
        TopologyEdge(id="e2", source="10.0.0.10", target="10.0.0.12", source_port="Te1/2", target_port="Te1/1", speed_mbps=10000),
        TopologyEdge(id="e3", source="10.0.0.11", target="10.0.0.21", source_port="Gi1/1", target_port="Gi1/1", speed_mbps=1000),
    ]

    # Without explicit core names, sw-hub (highest degree) becomes core (tier 1),
    # sw-bldg1 (has downstream child sw-leaf1) becomes distribution (tier 2), leaves are access (tier 3).
    out_nodes, _ = apply_graph_hierarchy(nodes, edges)
    roles = {n.ip: (n.role, n.tier) for n in out_nodes}
    assert roles["10.0.0.10"] == ("core", 1)
    assert roles["10.0.0.11"] == ("distribution", 2)
    assert roles["10.0.0.12"] == ("access", 3)
    assert roles["10.0.0.21"] == ("access", 3)

    # Pinning 10.0.0.11 as root forces re-rooting and re-orients edge e1 from 10.0.0.11 -> 10.0.0.10.
    pinned_nodes, reoriented = apply_graph_hierarchy(
        nodes,
        edges,
        overrides={"10.0.0.11": {"is_root": True, "pos_x": 120.0, "pos_y": 80.0}},
    )
    pinned_map = {n.ip: n for n in pinned_nodes}
    assert pinned_map["10.0.0.11"].is_root is True
    assert pinned_map["10.0.0.11"].tier == 1
    assert pinned_map["10.0.0.11"].pos_x == 120.0
    e1 = next(e for e in reoriented if e.id == "e1")
    assert e1.source == "10.0.0.11" and e1.target == "10.0.0.10"


def test_overrides_and_batch_layout_endpoints() -> None:
    ov_resp = client.put(
        "/api/topology/overrides/10.10.0.2",
        json={"is_root": True, "role_override": "core"},
    )
    assert ov_resp.status_code == 200
    assert ov_resp.json()["override"]["is_root"] is True

    layout_resp = client.post(
        "/api/topology/layout",
        json={
            "site_id": "local",
            "positions": [{"ip": "10.10.0.2", "pos_x": 300.0, "pos_y": 140.0}],
        },
    )
    assert layout_resp.status_code == 200
    assert layout_resp.json()["saved"] == 1

    topo = client.get("/api/topology").json()
    node = next(n for n in topo["nodes"] if n["ip"] == "10.10.0.2")
    assert node["is_root"] is True
    assert node["pos_x"] == 300.0
    assert node["pos_y"] == 140.0

    del_resp = client.delete("/api/topology/layout", params={"site_id": "local"})
    assert del_resp.status_code == 200

    topo_after = client.get("/api/topology").json()
    node_after = next(n for n in topo_after["nodes"] if n["ip"] == "10.10.0.2")
    assert node_after["pos_x"] is None

    # Clean up root pin so later tests see default state
    client.put("/api/topology/overrides/10.10.0.2", json={"is_root": False, "clear_role_override": True})


def test_endpoints_and_vlans_views() -> None:
    ep_resp = client.get("/api/endpoints", params={"search": "VMware"})
    assert ep_resp.status_code == 200
    ep_data = ep_resp.json()
    assert ep_data["total"] == 3
    assert all(e["switch_ip"] == "10.10.22.1" for e in ep_data["endpoints"])

    vlan_resp = client.get("/api/vlans")
    assert vlan_resp.status_code == 200
    vlan_data = vlan_resp.json()
    vlan_ids = {v["vlan"] for v in vlan_data["vlans"]}
    assert {10, 20, 30, 99, 100}.issubset(vlan_ids)


def test_multi_site_agent_registration_and_ingest() -> None:
    site_resp = client.post(
        "/api/sites",
        json={"site_id": "branch-bkk", "name": "Bangkok Branch", "description": "Remote office"},
    )
    assert site_resp.status_code == 201

    reg_resp = client.post(
        "/api/agents/register",
        json={"site_id": "branch-bkk", "name": "bkk-collector-01"},
    )
    assert reg_resp.status_code == 201
    reg_data = reg_resp.json()
    agent_id = reg_data["agent"]["agent_id"]
    token = reg_data["token"]
    assert token.startswith("na_")

    snapshot_payload = {
        "site_id": "branch-bkk",
        "agent_id": agent_id,
        "hostname": "bkk-probe-vm",
        "version": "0.1.0",
        "devices": [
            {
                "ip": "192.168.10.1",
                "hostname": "bkk-core-01",
                "vendor": "Cisco",
                "model": "C9300-24T",
                "role": "core",
                "tier": 1,
                "port_count": 24,
                "active_port_count": 12,
                "uplink_count": 1,
                "endpoint_count": 1,
            },
            {
                "ip": "192.168.10.2",
                "hostname": "bkk-acc-01",
                "vendor": "Aruba",
                "model": "2930F",
                "role": "access",
                "tier": 3,
                "port_count": 24,
                "active_port_count": 8,
                "uplink_count": 1,
                "endpoint_count": 0,
            },
        ],
        "raw_links": [
            {
                "local_ip": "192.168.10.1",
                "local_port": "Te1/1/1",
                "remote_ip": "192.168.10.2",
                "remote_port": "1/25",
                "speed": "10 Gbps",
                "up": "up",
                "remote_type": "LLDP",
            }
        ],
        "endpoints": [
            {
                "mac": "00:11:22:33:44:55",
                "ip": "192.168.10.105",
                "oui": "Dell Inc.",
                "vlan": "10",
                "switch_ip": "192.168.10.1",
                "switch_hostname": "bkk-core-01",
                "port": "Gi1/0/5",
                "active": True,
            }
        ],
        "vlans": [
            {
                "vlan": 10,
                "switch_count": 2,
                "port_count": 20,
                "native_port_count": 16,
                "switches": [
                    {"ip": "192.168.10.1", "hostname": "bkk-core-01", "port_count": 12, "native_port_count": 8}
                ],
            }
        ],
    }

    bad_ingest = client.post(
        "/api/v1/ingest",
        json=snapshot_payload,
        headers={"X-Agent-Token": "wrong-token"},
    )
    assert bad_ingest.status_code == 401

    ok_ingest = client.post(
        "/api/v1/ingest",
        json=snapshot_payload,
        headers={"X-Agent-Token": token},
    )
    assert ok_ingest.status_code == 202
    assert ok_ingest.json()["devices_ingested"] == 2

    remote_topo = client.get("/api/topology", params={"site_id": "branch-bkk"})
    assert remote_topo.status_code == 200
    assert len(remote_topo.json()["nodes"]) == 2
    assert len(remote_topo.json()["edges"]) == 1

    remote_eps = client.get("/api/endpoints", params={"site_id": "branch-bkk"})
    assert remote_eps.status_code == 200
    assert remote_eps.json()["total"] == 1

    agents = client.get("/api/agents").json()["agents"]
    bkk_agent = next(a for a in agents if a["agent_id"] == agent_id)
    assert bkk_agent["status"] == "online"
    assert bkk_agent["device_count"] == 2


def test_poller_helpers_and_status_endpoints() -> None:
    from app.services.poller import compute_next_status, parse_ping_latency_ms

    assert parse_ping_latency_ms("64 bytes from 10.10.0.1: icmp_seq=1 ttl=64 time=1.42 ms") == 1.42
    assert parse_ping_latency_ms("64 bytes from 10.10.0.1: icmp_seq=1 ttl=64 time<1 ms") == 1.0
    assert parse_ping_latency_ms("") is None

    assert compute_next_status(None, 0, True) == ("up", 0)
    assert compute_next_status("up", 0, False) == ("degraded", 1)
    assert compute_next_status("degraded", 1, False) == ("down", 2)
    assert compute_next_status("down", 2, True) == ("up", 0)

    poll_resp = client.post("/api/status/poll")
    assert poll_resp.status_code == 200
    poll_data = poll_resp.json()
    assert poll_data["mode"] == "mock"
    assert poll_data["total"] == 10
    assert poll_data["up"] == 10

    status_resp = client.get("/api/status")
    assert status_resp.status_code == 200
    assert status_resp.json()["up"] == 10

    topo = client.get("/api/topology").json()
    assert all(n["reachability"] == "up" and n["latency_ms"] is not None for n in topo["nodes"])

    devs = client.get("/api/devices").json()["devices"]
    assert all(d["reachability"] == "up" and d["latency_ms"] is not None for d in devs)
