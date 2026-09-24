# CanaryMesh — Industrial IoT Security Platform
## HackfiniX 2026 · TrustGrid · Track: Industrial Cybersecurity

---

## Folder Structure

```
canarymesh/
│
├── backend/     ← REST API + WebSocket + DB
│   ├── main.py                      FastAPI app, all endpoints
│   ├── database.py                  SQLite audit log
│   └── requirements.txt
│
├── ml_federated/            ← ML models + FL engine
│   ├── node_manager.py              IoT nodes + Isolation Forest
│   └── fl_engine.py                 FedAvg aggregation
│
├── iot_cybersecurity/       ← MQTT simulation + Honeypot
│   ├── honeypot.py                  Decoy device + probe detection
│   └── mqtt_broker.py               MQTT traffic simulator
│
└── frontend/      ← React SOC dashboard
    ├── src/
    │   ├── App.jsx                  Main app + 6 tabs
    │   ├── useWebSocket.js          Real-time WS hook
    │   └── components/
    │       ├── Dashboard.jsx        Topology map + stats + demo controls
    │       ├── NodesTab.jsx         Node list + ADD NODE feature
    │       ├── AlertsTab.jsx        Full alert feed + approve/clear
    │       ├── FLTab.jsx            FL rounds + gradient bars + history
    │       ├── MQTTTab.jsx          Live MQTT log + traffic bars
    │       ├── AuditTab.jsx         SQLite decision + alert history
    │       ├── AddNodeModal.jsx     Add custom PLC/Sensor/SCADA/HMI
    │       └── shared.jsx           NodeDetail + Badge + StatCard
    ├── package.json
    └── vite.config.js
```

---

## All Features Checklist

| Feature                    | Where                              | Status |
|----------------------------|------------------------------------|--------|
| Industrial IoT simulation  | ml_federated/node_manager.py              | ✅ |
| MQTT communication         | iot_cybersecurity/mqtt_broker.py               | ✅ |
| Local anomaly detection    | ml_federated/node_manager.py (IF model)   | ✅ |
| Federated Learning (FL)    | ml_federated/fl_engine.py (FedAvg)        | ✅ |
| Honeypot deception         | iot_cybersecurity/honeypot.py                  | ✅ |
| Threat scoring             | ml_federated/node_manager.py              | ✅ |
| Explainable alerts         | node.get_threat_reason()           | ✅ |
| Adaptive response tiers    | LOW/MEDIUM/HIGH/CRITICAL           | ✅ |
| Live SOC dashboard         | frontend/Dashboard.jsx                | ✅ |
| Real-time WebSocket        | backend/main.py + useWebSocket.js    | ✅ |
| Add/remove custom nodes    | frontend/NodesTab + AddNodeModal      | ✅ |
| Simulate attack on node    | Dashboard + NodesTab controls      | ✅ |
| Trigger honeypot probe     | Dashboard demo controls            | ✅ |
| MQTT live log              | frontend/MQTTTab.jsx                  | ✅ |
| SQLite audit trail         | backend/database.py + AuditTab       | ✅ |
| Node isolation + restore   | isolate / restore endpoints        | ✅ |
| FL aggregation method      | FedAvg on IF offset_ vectors       | ✅ |

---

## Quick Start

### Step 1 — Backend
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

### Step 2 — Frontend (new terminal)
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

---

## Deploy: Render (backend) + Netlify (frontend)

### Backend → Render
- Root dir: `backend`
- Build: `pip install -r requirements.txt`
- Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`

### Frontend → Netlify
- Root dir: `frontend`
- Build: `npm run build`
- Publish: `dist`
- Env var: `VITE_WS_URL=wss://YOUR-RENDER-URL/ws`
- Env var: `VITE_API_URL=https://YOUR-RENDER-URL`

---

## FL Aggregation — Judge Q&A

**Q: Isolation Forest doesn't have gradients like neural networks — how do you do FL?**

A: We serialize two parameters per node:
1. `model.offset_` — the decision threshold learned by the local IF model
2. Current anomaly score (as contamination proxy)

These form a compact parameter vector. FedAvg computes a traffic-weighted mean across all active nodes. The aggregated vector is broadcast back and nodes update their detection threshold accordingly. Raw sensor data never leaves any node.

---

Built by TrustGrid · Cambridge Institute of Technology · HackfiniX 2026
