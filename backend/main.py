"""
CanaryMesh — Backend
Full 4-phase flow: Detection → Sanitization → Health Check → Reconnection
"""
import asyncio, logging, uuid
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'ml_federated'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'iot_cybersecurity'))
from fl_engine import FederatedEngine
from node_manager import NodeManager
from honeypot import HoneypotServer
from database import init_db, log_alert, log_decision, get_recent_alerts, get_decisions
from sanitizer import NodeSanitizer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("canarymesh")

node_manager = NodeManager()
fl_engine    = FederatedEngine(node_manager)
honeypot     = HoneypotServer(node_manager)
sanitizer    = NodeSanitizer(node_manager, fl_engine)
ws_clients: list[WebSocket] = []

async def broadcast(data):
    dead = []
    for ws in ws_clients:
        try: await ws.send_json(data)
        except: dead.append(ws)
    for ws in dead:
        if ws in ws_clients: ws_clients.remove(ws)

async def simulation_loop():
    tick = 0
    while True:
        await asyncio.sleep(2)
        try:
            tick += 1
            node_updates = node_manager.tick()
            new_alerts   = node_manager.check_alerts()
            fl_update = None
            if tick % 5 == 0:
                fl_update = await fl_engine.run_round()
            for event in honeypot.check_probes():
                alert = {"id": f"hp_{uuid.uuid4().hex[:8]}", "nodeId": event["honeypot_id"],
                    "node": event["honeypot_name"], "time": datetime.utcnow().strftime("%H:%M:%S"),
                    "severity": "HIGH",
                    "reason": f"Honeypot probed from {event['source_ip']}. Credentials: {event['credentials']}. Pattern: {event.get('attack_pattern','—')}."}
                new_alerts.append(alert)
                await log_alert(alert)
            for a in new_alerts: await log_alert(a)
            await broadcast({"type":"state_update","nodes":node_updates,"alerts":new_alerts,
                             "fl":fl_update,"timestamp":datetime.utcnow().isoformat()})
        except Exception as e:
            logger.error(f"Loop error: {e}", exc_info=True)

@asynccontextmanager
async def lifespan(app):
    await init_db(); honeypot.start()
    asyncio.create_task(simulation_loop())
    logger.info("CanaryMesh started ✓")
    yield
    honeypot.stop()

app = FastAPI(title="CanaryMesh API", version="3.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class AddNodeReq(BaseModel):
    name: str; node_type: str; base_traffic: int = 100

class AttackReq(BaseModel):
    node_id: str; intensity: float = 0.8

@app.get("/")
def root(): return {"status":"ok","version":"3.0.0"}

@app.get("/api/nodes")
def get_nodes(): return {"nodes": node_manager.get_all_nodes()}

@app.post("/api/nodes")
async def add_node(req: AddNodeReq):
    node = node_manager.add_node(req.name, req.node_type, req.base_traffic)
    await broadcast({"type":"node_added","node":node}); return {"success":True,"node":node}

@app.delete("/api/nodes/{node_id}")
async def remove_node(node_id: str):
    if node_manager.remove_node(node_id):
        await broadcast({"type":"node_removed","node_id":node_id}); return {"success":True}
    return {"success":False}

@app.post("/api/nodes/{node_id}/isolate")
async def isolate_node(node_id: str, operator: str = "operator"):
    result = node_manager.isolate_node(node_id)
    if not result: return {"success":False}
    alert = {"id":f"iso_{uuid.uuid4().hex[:8]}","nodeId":node_id,"node":result["name"],
        "time":datetime.utcnow().strftime("%H:%M:%S"),"severity":"HIGH",
        "reason":f"Node manually isolated by {operator}. Removed from FL mesh."}
    await log_alert(alert)
    await log_decision({"node_id":node_id,"action":"isolate","operator":operator,
        "reason":"Manual isolation","timestamp":datetime.utcnow().isoformat()})
    await broadcast({"type":"node_isolated","node_id":node_id,"alert":alert})
    return {"success":True}

# ── PHASE 2+3: Sanitize ───────────────────────────────────────────────────────
@app.post("/api/nodes/{node_id}/sanitize")
async def sanitize_node(node_id: str, operator: str = "operator"):
    node = node_manager.nodes.get(node_id)
    if not node: return {"success":False,"error":"Node not found"}
    node_manager.set_sanitizing(node_id)
    await broadcast({"type":"sanitization_started","node_id":node_id,
        "node_name":node.name,"timestamp":datetime.utcnow().isoformat()})
    asyncio.create_task(_run_sanitization(node_id, node.name, operator))
    return {"success":True}

async def _run_sanitization(node_id, node_name, operator):
    audit = []
    # Step 1 — Block attacker IP
    await asyncio.sleep(1.2)
    ip = sanitizer.block_attacker_ip(node_id)
    e = f"[IP Blocked] {node_name} — {ip} added to MQTT ACL drop list"
    audit.append(e)
    await log_decision({"node_id":node_id,"action":"block_ip","operator":"system","reason":e,"timestamp":datetime.utcnow().isoformat()})
    await broadcast({"type":"sanitization_progress","node_id":node_id,"phase":"block_ip","message":e,"step":1,"total_steps":4})

    # Step 2 — Purge command queue
    await asyncio.sleep(1.2)
    sanitizer.purge_command_queue(node_id)
    e = f"[Buffer Purged] {node_name} — volatile command queue cleared, PLC setpoints reset to factory baseline"
    audit.append(e)
    await log_decision({"node_id":node_id,"action":"purge_queue","operator":"system","reason":e,"timestamp":datetime.utcnow().isoformat()})
    await broadcast({"type":"sanitization_progress","node_id":node_id,"phase":"purge_queue","message":e,"step":2,"total_steps":4})

    # Step 3 — Restore FL model
    await asyncio.sleep(1.2)
    fl_round = sanitizer.restore_fl_model(node_id)
    e = f"[FL Model Reset] {node_name} — corrupted weights discarded, Clean Global Model Round #{fl_round} applied"
    audit.append(e)
    await log_decision({"node_id":node_id,"action":"fl_model_reset","operator":"system","reason":e,"timestamp":datetime.utcnow().isoformat()})
    await broadcast({"type":"sanitization_progress","node_id":node_id,"phase":"fl_model_reset",
        "message":e,"step":3,"total_steps":4,"fl_round":fl_round})

    # Step 4 — Health check (10-second window)
    node_manager.set_health_checking(node_id)
    e = f"[Health Check] {node_name} — 10-second telemetry observation window started"
    await broadcast({"type":"sanitization_progress","node_id":node_id,"phase":"health_check",
        "message":e,"step":4,"total_steps":4})
    await asyncio.sleep(10)

    passed = sanitizer.verify_health(node_id)
    if passed:
        node_manager.set_ready_for_reconnect(node_id)
        e = f"[Health Check Passed] {node_name} — packet rates, request frequency and sensor variances within normal bounds"
        await log_decision({"node_id":node_id,"action":"health_check_passed","operator":"system","reason":e,"timestamp":datetime.utcnow().isoformat()})
        await broadcast({"type":"sanitization_complete","node_id":node_id,"node_name":node_name,
            "passed":True,"message":e,"audit_entries":audit})
    else:
        e = f"[Health Check Failed] {node_name} — telemetry still anomalous. Manual review required."
        await broadcast({"type":"sanitization_complete","node_id":node_id,"node_name":node_name,
            "passed":False,"message":e,"audit_entries":audit})

# ── PHASE 4: Reconnect ────────────────────────────────────────────────────────
@app.post("/api/nodes/{node_id}/reconnect")
async def reconnect_node(node_id: str, operator: str = "operator"):
    result = node_manager.reconnect_node(node_id)
    if not result: return {"success":False,"error":"Node not ready for reconnection"}
    e = f"[Reconnected] {result['name']} — operator approved. MQTT routing restored. Node back in FL mesh."
    await log_decision({"node_id":node_id,"action":"reconnect","operator":operator,"reason":e,"timestamp":datetime.utcnow().isoformat()})
    await broadcast({"type":"node_reconnected","node_id":node_id,"node_name":result["name"],
        "message":e,"timestamp":datetime.utcnow().isoformat()})
    return {"success":True}

@app.post("/api/nodes/{node_id}/restore")
async def restore_node(node_id: str):
    if node_manager.restore_node(node_id):
        await broadcast({"type":"node_restored","node_id":node_id}); return {"success":True}
    return {"success":False}

@app.post("/api/simulate/attack")
async def sim_attack(req: AttackReq):
    if node_manager.trigger_attack(req.node_id, req.intensity):
        await broadcast({"type":"attack_simulated","node_id":req.node_id,"intensity":req.intensity})
        return {"success":True}
    return {"success":False}

@app.post("/api/simulate/honeypot_probe")
async def trigger_hp():
    event = honeypot.manual_probe()
    alert = {"id":f"hp_{uuid.uuid4().hex[:8]}","nodeId":event["honeypot_id"],
        "node":event["honeypot_name"],"time":datetime.utcnow().strftime("%H:%M:%S"),
        "severity":"HIGH","reason":f"Manual honeypot probe. Source: {event['source_ip']}. Pattern: {event.get('attack_pattern','—')}."}
    await log_alert(alert)
    await broadcast({"type":"state_update","nodes":[],"alerts":[alert],"fl":None,"timestamp":datetime.utcnow().isoformat()})
    return {"success":True,"alert":alert}

@app.get("/api/alerts")
async def get_alerts(limit: int = 50): return {"alerts": await get_recent_alerts(limit)}

@app.post("/api/alerts/{alert_id}/approve")
async def approve_alert(alert_id: str):
    node_manager.approve_isolation(alert_id)
    await broadcast({"type":"alert_approved","alert_id":alert_id}); return {"success":True}

@app.delete("/api/alerts")
async def clear_alerts():
    node_manager.clear_alerts()
    await broadcast({"type":"alerts_cleared"}); return {"success":True}

@app.get("/api/fl/status")
def fl_status(): return fl_engine.get_status()

@app.get("/api/audit")
async def audit(limit: int = 100): return {"decisions": await get_decisions(limit)}

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept(); ws_clients.append(ws)
    await ws.send_json({"type":"init","nodes":node_manager.get_all_nodes(),
        "alerts":node_manager.get_active_alerts(),"fl":fl_engine.get_status(),
        "timestamp":datetime.utcnow().isoformat()})
    try:
        while True:
            msg = await ws.receive_json()
            a = msg.get("action")
            if a == "isolate":
                r = node_manager.isolate_node(msg["node_id"])
                if r:
                    alert = {"id":f"iso_{uuid.uuid4().hex[:8]}","nodeId":msg["node_id"],
                        "node":r["name"],"time":datetime.utcnow().strftime("%H:%M:%S"),
                        "severity":"HIGH","reason":"Node manually isolated by operator."}
                    await log_alert(alert)
                    await broadcast({"type":"node_isolated","node_id":msg["node_id"],"alert":alert})
            elif a == "sanitize":
                node = node_manager.nodes.get(msg["node_id"])
                if node:
                    node_manager.set_sanitizing(msg["node_id"])
                    asyncio.create_task(_run_sanitization(msg["node_id"], node.name, "operator"))
                    await broadcast({"type":"sanitization_started","node_id":msg["node_id"],"node_name":node.name,"timestamp":datetime.utcnow().isoformat()})
            elif a == "reconnect":
                r = node_manager.reconnect_node(msg["node_id"])
                if r: await broadcast({"type":"node_reconnected","node_id":msg["node_id"],"node_name":r["name"],"timestamp":datetime.utcnow().isoformat()})
            elif a == "restore":
                node_manager.restore_node(msg["node_id"]); await broadcast({"type":"node_restored","node_id":msg["node_id"]})
            elif a == "approve_isolation":
                node_manager.approve_isolation(msg["alert_id"]); await broadcast({"type":"alert_approved","alert_id":msg["alert_id"]})
            elif a == "clear_alerts":
                node_manager.clear_alerts(); await broadcast({"type":"alerts_cleared"})
            elif a == "add_node":
                node = node_manager.add_node(msg["name"], msg["node_type"], msg.get("base_traffic",100))
                await broadcast({"type":"node_added","node":node})
            elif a == "remove_node":
                node_manager.remove_node(msg["node_id"]); await broadcast({"type":"node_removed","node_id":msg["node_id"]})
            elif a == "simulate_attack":
                node_manager.trigger_attack(msg["node_id"], msg.get("intensity",0.8))
    except WebSocketDisconnect:
        if ws in ws_clients: ws_clients.remove(ws)
