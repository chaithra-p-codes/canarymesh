# CanaryMesh — Federated Anomaly Detection for Industrial IoT

**Track:** Industrial Cybersecurity
**Team:** TrustGrid — IC01<br>
Chaithra P  · Aarathi M Iyer · Abhinand J Prakash · Deekshitha R

CanaryMesh is a SOC (Security Operations Center) prototype for industrial IoT/OT
networks. It detects anomalous device behavior using per-device Isolation Forest
models trained on real benchmark telemetry, scores risk, automatically quarantines
high-risk devices, walks them through a scripted sanitization + health-check
recovery flow, and streams every step to a live React dashboard over WebSocket —
with a full SQLite audit trail behind it.

Traditional signature-based IDS tools miss novel attacks on OT networks, and a
single compromised PLC or sensor can cascade into a full production shutdown.
CanaryMesh's core idea is that each device's anomaly model can be trained without
ever moving raw factory data off-site — only compact model parameters are
aggregated centrally.

---

## Table of contents

- [Architecture](#architecture)
- [Folder structure](#folder-structure)
- [Prerequisites](#prerequisites)
- [Setup & run](#setup--run)
  - [1. Backend](#1-backend)
  - [2. Frontend](#2-frontend)
  - [3. MQTT broker (optional)](#3-mqtt-broker-optional)
  - [4. Marketing / auth / admin pages (optional)](#4-marketing--auth--admin-pages-optional)
- [Verifying it's working](#verifying-its-working)
- [API reference](#api-reference)
- [Risk scoring](#risk-scoring)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
 INDUSTRIAL IoT / OT NODES         FEDERATED LEARNING       GLOBAL THREAT
 (PLC-01, Weather-02,               LAYER                    INTELLIGENCE
  SCADA-03, Garage-04, ...)    ┌─────────────────────┐  ┌──────────────────┐
  ┌────────────┐               │  Local Isolation     │  │  Aggregated      │
  │ Benchmark   │──telemetry──▶│  Forest per device   │─▶│  model update    │
  │ replay (DB) │              │  (trained on normal  │  │  (offset params, │
  └────────────┘               │   rows only)         │  │   no raw data)   │
                                └─────────────────────┘  └────────┬─────────┘
                                                                    │
                     ┌──────────────────────────────────────────────┘
                     ▼
        ┌────────────────────────┐        ┌───────────────────────┐
        │  DECEPTION LAYER        │        │  ADAPTIVE RESPONSE     │
        │  Honeypot decoys        │──────▶│  Low     → Alert only  │
        │  reveal probes instantly│        │  Medium  → Approval    │
        └────────────────────────┘        │  High    → Auto-isolate│
                                           │  Critical→ Quarantine  │
                                           └───────────┬───────────┘
                                                        ▼
                              ┌─────────────────────────────────────────┐
                              │ 4-PHASE RECOVERY (sanitizer.py)          │
                              │ 1. Block attacker IP in MQTT ACL         │
                              │ 2. Purge volatile command queue          │
                              │ 3. Restore clean FL model weights        │
                              │ 4. 10s health-check window → reconnect   │
                              └───────────────────┬───────────────────────┘
                                                   ▼
                                       ┌───────────────────────┐
                                       │  SOC DASHBOARD (React) │
                                       │  Live via WebSocket    │
                                       │  + SQLite audit log    │
                                       └───────────────────────┘
```

End-to-end lifecycle logged to the audit trail:
`Attack Identified → IP Blocked → Command Queue Purged → FL Model Reset → Health Check Passed → Operator Reconnected`

## Folder structure

```
canarymesh/
├── README.md                    ← this file
│
├── backend/
│   ├── main.py                  FastAPI app: REST routes + /ws WebSocket + simulation loop
│   ├── database.py              SQLite: telemetry, MQTT log, alerts, decisions (audit trail)
│   ├── dataset_loader.py        Downloads/imports ToN-IoT CSVs into SQLite, builds replay index
│   ├── mqtt_service.py          Publishes dataset-backed payloads to a real MQTT broker
│   ├── sanitizer.py             4-phase sanitization logic (block IP / purge / restore / verify)
│   ├── requirements.txt
│   └── .env.example             Optional backend runtime config (copy to backend/.env)
│
├── ml_federated/
│   ├── node_manager.py          Per-device Isolation Forest + risk fusion + state machine
│   └── fl_engine.py             Compact federated parameter aggregation ("FedAvg on IF offsets")
│
├── iot_cybersecurity/
│   ├── honeypot.py              Decoy device probe events (PLC-99, Sensor-98)
│   └── mqtt_broker.py           Legacy compatibility wrapper (real publishing is in mqtt_service.py)
│
├── data/
│   ├── Train_Test_IoT_Modbus.csv
│   ├── Train_Test_IoT_Weather.csv
│   ├── Train_Test_IoT_Garage_Door.csv
│   └── Train_Test_IoT_Thermostat.csv
│
├── frontend/
│   ├── index.html
│   ├── vite.config.js           Dev-server proxy: /api and /ws → http://localhost:8000
│   ├── package.json
│   ├── .env                     VITE_API_URL / VITE_WS_URL
│   └── src/
│       ├── main.jsx
│       ├── App.jsx              Tabs: Dashboard / Devices / Alerts / MQTT Log / FL / Audit
│       ├── useWebSocket.js      REST hydration + live WebSocket state
│       └── components/
│           ├── Dashboard.jsx        Threat overview, network map, live audit feed
│           ├── NodesTab.jsx          Device list (the "Devices" tab)
│           ├── AlertsTab.jsx         Alerts + approve/clear actions
│           ├── MQTTTab.jsx           Real MQTT publish log
│           ├── FLTab.jsx             Federated aggregation status
│           ├── AuditTab.jsx          Full decision/audit log
│           ├── AddNodeModal.jsx      Add-device modal
│           ├── ArchitectureFlow.jsx  Visual architecture diagram
│           └── shared.jsx            Shared UI primitives
│
└── product/                     Static, standalone HTML mockups (not built by Vite)
    ├── landing/index.html           Marketing/pricing landing page
    ├── auth/login.html              Login page (with demo credentials for judges)
    ├── auth/register.html           4-step company onboarding
    ├── onboarding/dashboard.html    Company-branded SOC view w/ localStorage persistence
    └── admin/admin.html             Admin panel listing "registered companies"
```

## Prerequisites

- **Python** 3.10+ (tested with 3.11–3.14)
- **Node.js** 18+ and npm
- (Optional) **Mosquitto** or another MQTT broker, for real MQTT publishing
- The four ToN-IoT CSV files in `data/` (already included in this build). If missing,
  the backend will try to download them automatically from the mirror configured in
  `backend/.env.example` — see `data/README.md`.

## Setup & run

Two terminals: one for the backend, one for the frontend.

### 1. Backend

**macOS / Linux**
```bash
cd backend
python3 -m pip install -r requirements.txt
python3 -m uvicorn main:app --reload --port 8000
```

**Windows (PowerShell)**
```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

On first startup the backend imports the CSV files in `data/` into
`backend/canarymesh.db` (SQLite) and trains a local Isolation Forest per device.
This takes roughly 10–20 seconds — watch the terminal for:

```
INFO:canarymesh:CanaryMesh backend started successfully
INFO:canarymesh:Dataset mode: database_replay
INFO:     Application startup complete.
```

Backend runs at `http://localhost:8000`.

> Optional config: copy `backend/.env.example` to `backend/.env` to override the
> tick interval, health-check window length, which datasets load, or MQTT settings.

### 2. Frontend

In a second terminal:

**macOS / Linux**
```bash
cd frontend
rm -rf node_modules package-lock.json   # only needed if you copied node_modules from another OS
npm install
npm run dev
```

**Windows (PowerShell)**
```powershell
cd frontend
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item package-lock.json -ErrorAction SilentlyContinue
npm install
npm run dev
```

Open **http://localhost:5173**. Vite's dev server proxies `/api/*` and `/ws` to
the backend on port 8000 (see `frontend/vite.config.js`), and `frontend/.env`
also points directly at `http://127.0.0.1:8000` / `ws://127.0.0.1:8000/ws` as a
fallback if you serve the frontend separately from the proxy.

> **To reach the dashboard through the product landing page instead of the raw
> Vite URL:** with the frontend running, open `product/landing/index.html` with live server and click **"View live demo"** — it links straight to
> `http://localhost:5173/`, so the frontend must already be running for that
> button to work.

To build a static production bundle instead:
```bash
npm run build     # outputs to frontend/dist
npm run preview   # serve the built bundle locally
```

### 3. MQTT broker (optional)

If you want the **MQTT Log** tab to show genuinely published messages instead of
`recorded_only` entries, run Mosquitto locally on the default port:

```bash
# macOS (Homebrew)
brew install mosquitto
mosquitto -v

# Ubuntu/Debian
sudo apt install mosquitto
mosquitto -v

# Windows: install from https://mosquitto.org/download/ then
mosquitto -v
```

The backend auto-detects the broker at `127.0.0.1:1883` (configurable via
`backend/.env`). If no broker is running, the app still works fully — publishes
are just recorded as `recorded_only` in SQLite instead of sent over the network.

### 4. Marketing / auth / admin pages (optional)

`product/*.html` are self-contained static pages (no build step, no bundler) —
just open them directly in a browser, e.g.:

```bash
open product/landing/index.html      # macOS
start product/landing/index.html     # Windows
```

They're a UI mockup of the surrounding product (landing page, login, onboarding,
admin panel) and are not wired to the FastAPI backend's real auth. The landing
page's **"View live demo"** button is the one exception — it links directly to
`http://localhost:5173/`, so with the frontend running this is a normal way to
reach the actual SOC dashboard.

## Verifying it's working

**macOS/Linux:**
```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/state
curl http://127.0.0.1:8000/api/dataset/status
```

**Windows (PowerShell):**
```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/state
Invoke-RestMethod http://127.0.0.1:8000/api/dataset/status
```

A healthy response from `/api/health` looks like:
```json
{"status":"ok","backend":true,"datasetLoaded":true,"deviceCount":6, "...": "..."}
```

In the browser, open DevTools → Network while loading the dashboard. You should
see `GET /api/state`, `/api/mqtt/recent`, `/api/dataset/attack-types`, followed by
a persistent `/ws` WebSocket connection carrying `state_update` messages every
~2 seconds (the simulation tick).

## API reference

All routes are served by `backend/main.py` on port 8000.

| Method | Route | Purpose |
|---|---|---|
| GET | `/` | Root status |
| GET | `/api/health` | Backend/dataset/MQTT health snapshot |
| GET | `/api/state` | Full current state (devices, alerts, FL status) |
| GET | `/api/devices` | List devices |
| GET | `/api/nodes` | Legacy alias for devices |
| GET | `/api/telemetry/recent` | Recent replayed telemetry rows |
| POST | `/api/devices` | Add a device |
| POST | `/api/devices/{device_id}/replay-attack` | Queue an actual attack-labeled dataset row for replay |
| POST | `/api/devices/{device_id}/isolate` | Isolate a device |
| POST | `/api/nodes/{node_id}/isolate` | Legacy alias |
| POST | `/api/nodes/{node_id}/sanitize` | Start the 4-phase sanitization flow |
| POST | `/api/simulate/intrusion` | Trigger a simulated intrusion event |
| POST | `/api/nodes/{node_id}/reconnect` | Approve reconnection after a passed health check |
| POST | `/api/nodes/{node_id}/restore` | Restore a removed/failed node |
| GET | `/api/alerts` | Recent alerts |
| POST | `/api/alerts/{alert_id}/approve` | Approve a pending alert/isolation |
| POST | `/api/alerts/clear` | Clear all alerts |
| GET | `/api/audit` | Full audit/decision log |
| GET | `/api/mqtt/recent` | Recent MQTT publish records |
| GET | `/api/mqtt/status` | MQTT broker connection status |
| GET | `/api/dataset/status` | Loaded datasets, row counts, attack types |
| GET | `/api/dataset/attack-types` | Attack type taxonomy per dataset |
| GET | `/api/fl/status` | Federated aggregation status/round |
| GET | `/api/risk/thresholds` | Current Low/Medium/High/Critical policy thresholds |
| POST | `/api/simulate/honeypot_probe` | Trigger a controlled honeypot probe event |
| WS | `/ws` | Live state stream (`state_update`, alert, and sanitization progress events) |

## Risk scoring

Risk is a **policy score derived from model output**, not a probability read
from the dataset's ground-truth label (the label is only used afterward for
evaluation/explanation):

```
riskScore = 100 × (
    0.40 × anomalyScore
  + 0.15 × persistenceScore
  + 0.10 × featureDeviationScore
  + 0.35 × isolationForestOutlierFlag
)

LOW      : < 25
MEDIUM   : 25–49.99
HIGH     : 50–74.99
CRITICAL : ≥ 75
```

`Medium` severity sets a device to "pending approval." `High`/`Critical` trigger
automatic isolation at the MQTT-broker level in the simulation.

## Troubleshooting

- **`vite: Permission denied` or native-binary errors on frontend install** —
  usually means `node_modules` was copied from a different OS. Delete
  `node_modules` and `package-lock.json` and run `npm install` fresh on the
  machine you're running on (see [Frontend](#2-frontend) above).
- **`/api/health` shows `datasetLoaded: false`** — the CSVs in `data/` are
  missing and the automatic download failed (no internet, or the mirror is
  unreachable). Place the four CSV files listed in `data/README.md` manually.
- **MQTT status shows `Connection refused`** — no broker is running on
  `127.0.0.1:1883`. This is expected if you skipped step 3; the app still works,
  MQTT events are just marked `recorded_only`.
- **Frontend loads but shows no data** — check that the backend is running on
  port 8000 and that `frontend/.env` / `vite.config.js` point at the right host;
  open DevTools → Network and confirm `/ws` connects.
