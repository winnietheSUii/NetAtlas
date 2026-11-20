# NetAtlas

Enterprise multi-vendor L2/L3 network discovery and live topology mapping platform.

NetAtlas pairs **Netdisco** (strictly as a headless Docker discovery engine) with a custom **Python FastAPI** backend reading directly from Netdisco's PostgreSQL database and a custom **React + TypeScript + Tailwind CSS + React Flow** web UI.

---

## Architecture

- **Headless Netdisco Engine (`compose.yaml`):**
  - `netdisco-postgresql` (`netdisco/netdisco:latest-postgresql`)
  - `netdisco-db-init` (runs `netdisco-updatedb.sh` cleanly before services start)
  - `netdisco-backend` (`netdisco/netdisco:latest-backend`, SNMP/CDP/LLDP/MAC/ARP poller)
  - `netdisco-web` (optional `--profile dev` on port `5000` to cross-check discovery results)
- **FastAPI Backend (`api/`):**
  - Connects directly to Netdisco's PostgreSQL schema (`device`, `device_ip`, `device_port`, `device_port_vlan`, `node`, `node_ip`, `admin`) using `psycopg` async connection pooling and parameterized SQL.
  - Deduplicates bidirectional CDP/LLDP switch links while preserving distinct parallel uplinks.
  - Queues `discover`, `macsuck`, and `arpnip` jobs directly in Netdisco's `admin` table (no Docker socket mount required).
  - Supports `MOCK_MODE=true` for instant UI development/testing without live switches.
- **Custom UI (`ui/`):**
  - Interactive React Flow + Dagre hierarchical topology canvas (`Top-Down` & `Left-Right`), link-speed coding, parallel cable separation, dark/light theme.
  - Slide-over `DeviceDrawer` displaying port status, native/tagged VLANs, clickable neighbor links, and connected MAC/IP endpoints.
  - `ScanModal` for seeding Core Switch IPs and watching live Netdisco job status.
  - Searchable, filterable, sortable `InventoryPage`.

---

## Quick Start (Windows PowerShell)

### 1. Create `.env`

```powershell
Copy-Item .env.example .env
```

### 2. Run in `MOCK_MODE=true` (UI + API Dev Testing Without Switches)

`.env.example` defaults to `MOCK_MODE=true`. Start only the `api` and `ui` containers to develop or demo immediately:

```powershell
docker compose up -d --build --no-deps api ui
```

Open the UI at **http://localhost:5173** and verify API endpoints in PowerShell:

```powershell
Invoke-RestMethod http://localhost:8000/api/health
Invoke-RestMethod http://localhost:8000/api/topology | ConvertTo-Json -Depth 4
Invoke-RestMethod http://localhost:8000/api/devices
Invoke-RestMethod http://localhost:8000/api/devices/10.10.0.1/ports
Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/scan -ContentType "application/json" -Body '{"target_ip":"10.10.0.1","actions":["discover","macsuck","arpnip"]}'
Invoke-RestMethod http://localhost:8000/api/scan/jobs
```

Run backend unit & API tests inside the container:

```powershell
docker compose run --rm -e MOCK_MODE=true api pytest -v
```

### 3. Run Live Netdisco Discovery (`MOCK_MODE=false`)

1. Edit [`netdisco/config/deployment.yml`](netdisco/config/deployment.yml) and configure your site's SNMPv3 (`authPriv`) or SNMPv2c read-only credentials under `device_auth:`.
2. Set `MOCK_MODE=false` inside `.env`:

```powershell
(Get-Content .env) -replace '^MOCK_MODE=.*', 'MOCK_MODE=false' | Set-Content .env
```

3. Start the full stack including `netdisco-postgresql`, `netdisco-db-init`, `netdisco-backend`, `api`, `ui`, and optional `netdisco-web` (on port `5000` for cross-checking):

```powershell
docker compose --profile dev up -d --build
```

4. Watch initialization and backend logs:

```powershell
docker compose logs -f netdisco-db-init netdisco-backend
```

5. Trigger a seed Core Switch discovery via **Scan Network** in http://localhost:5173 (or via PowerShell):

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/scan -ContentType "application/json" -Body '{"target_ip":"<CORE_SWITCH_IP>","actions":["discover","macsuck","arpnip"]}'
```

Cross-check raw Netdisco discovery data at **http://localhost:5000**.

---

## Production Deployment (Ubuntu Server + Nginx)

1. Prepare environment & permissions for Netdisco bind mounts (`UID/GID 901` inside Netdisco containers):

```bash
cp .env.example .env
# Set MOCK_MODE=false and a strong NETDISCO_DB_PASS in .env
# Configure SNMPv3/v2c credentials in netdisco/config/deployment.yml
sudo chown -R 901:901 netdisco/logs netdisco/nd-site-local
```

2. Launch with production overrides (`Nginx` on port 80, no exposed PostgreSQL/API ports, `restart: unless-stopped`):

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d --build
```
