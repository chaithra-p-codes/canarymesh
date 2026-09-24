"""
CanaryMesh — Node Manager
Manages all IoT nodes. Each node runs a local Isolation Forest
anomaly detection model. Raw data never leaves the node.
"""

import random
import uuid
import sys
import os
from datetime import datetime
from typing import Optional

import numpy as np
from sklearn.ensemble import IsolationForest

# Ensure we can import MQTTBrokerSimulator
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'iot_cybersecurity'))
from mqtt_broker import MQTTBrokerSimulator, MQTTMessage

# Fixed topology positions for original nodes
FIXED_POSITIONS = {
    "N1": {"x": 18, "y": 22},
    "N2": {"x": 42, "y": 14},
    "N3": {"x": 68, "y": 20},
    "N4": {"x": 28, "y": 52},
    "N5": {"x": 55, "y": 48},
    "N6": {"x": 80, "y": 55},
}

SEVERITY_THRESHOLDS = {
    "CRITICAL": 0.75,
    "HIGH":     0.60,
    "MEDIUM":   0.35,
    "LOW":      0.20,
}


class IoTNode:
    """
    Single industrial IoT node with its own local Isolation Forest model.
    Extracts features from actual generated MQTT messages rather than purely synthetic floats.
    """

    def __init__(self, node_id: str, name: str, node_type: str,
                 base_traffic: int = 100, position: dict = None, broker: MQTTBrokerSimulator = None):
        self.id           = node_id
        self.name         = name
        self.type         = node_type
        self.is_isolated  = False
        self.under_attack = False
        self.attack_intensity = 0.0

        # Unique per-node baseline (simulates device fingerprint)
        self.base_traffic      = base_traffic
        
        # We don't strictly need these for generation now, but let's keep them as metadata
        self.base_query_rate   = random.uniform(0.85, 1.15)
        self.base_packet_size  = random.uniform(0.90, 1.10)
        self.base_port_div     = random.uniform(0.88, 1.12)

        self.anomaly_score = random.uniform(0.03, 0.10)
        self.traffic       = base_traffic
        self.gradient: Optional[np.ndarray] = None
        self.last_evidence: dict = {}
        self.persistence_score = 0.0

        # Map position (auto-placed if not fixed)
        self.position = position or {
            "x": random.uniform(10, 85),
            "y": random.uniform(10, 85),
        }

        # Train local model on synthetic normal baseline
        self.model = IsolationForest(
            n_estimators=100,
            contamination=0.05,
            random_state=42,
        )
        self._train_baseline(broker)

    def extract_features(self, messages: list[MQTTMessage]) -> np.ndarray:
        if not messages:
            return np.array([[0, 0, 0, 0]])
            
        traffic = len(messages)
        
        # query_rate: read commands / total
        read_msgs = sum(1 for m in messages if m.command == "READ")
        query_rate = read_msgs / max(1, traffic)
        
        # packet_size: avg len(payload)
        packet_size = sum(len(m.payload) for m in messages) / max(1, traffic)
        
        # dest_count: unique destinations
        destinations = set(m.destination for m in messages)
        dest_count = len(destinations)
        
        # Check for honeypot interaction
        honeypot_interaction = any(d in ["HP1", "HP2"] for d in destinations)
        
        return np.array([[traffic, query_rate, packet_size, dest_count]]), honeypot_interaction

    def generate_window_messages(self, broker: MQTTBrokerSimulator, under_attack=False) -> list[MQTTMessage]:
        if under_attack:
            i = self.attack_intensity
            msg_count = int(self.base_traffic * (1 + i * random.uniform(2.5, 4.5)))
        else:
            msg_count = int(max(10, random.gauss(self.base_traffic, self.base_traffic * 0.1)))
            
        msgs = []
        for _ in range(msg_count):
            msg = broker.generate_message(
                self.id, self.name, self.type, under_attack=under_attack
            )
            # 10% chance during attack to probe honeypot
            if under_attack and random.random() < 0.1:
                msg.destination = random.choice(["HP1", "HP2"])
                
            msgs.append(msg)
        return msgs

    def _train_baseline(self, broker: MQTTBrokerSimulator):
        """Generate 300 normal windows of actual MQTT messages and fit local Isolation Forest."""
        if not broker:
            return
        
        normal_samples = []
        for _ in range(300):
            msgs = self.generate_window_messages(broker, under_attack=False)
            feats, _ = self.extract_features(msgs)
            normal_samples.append(feats[0])
            
        if normal_samples:
            self.model.fit(normal_samples)
            
    def apply_global_model(self, global_offset: float):
        """Apply federated learning parameters (offset) to local Isolation Forest."""
        if hasattr(self, 'model') and hasattr(self.model, 'offset_'):
            self.model.offset_ = global_offset

    def tick(self, broker: MQTTBrokerSimulator) -> float:
        """
        One simulation step:
        1. Generate window of MQTT messages
        2. Extract features
        3. Score with local Isolation Forest
        4. Apply temporal persistence and honeypot rules
        """
        if self.is_isolated:
            return self.anomaly_score

        msgs = self.generate_window_messages(broker, under_attack=self.under_attack)
        features, honeypot_hit = self.extract_features(msgs)
        
        # In scikit-learn IsolationForest, raw < 0 is anomaly after offset_ is applied.
        # We'll use raw for scoring.
        raw = self.model.decision_function(features)[0]          # higher = more normal
        normalized = float(np.clip((0.2 - raw) / 0.4, 0.0, 1.0))

        # Exponential smoothing
        self.anomaly_score = self.anomaly_score * 0.55 + normalized * 0.45
        self.traffic = int(features[0][0])
        
        # Temporal persistence logic
        if self.anomaly_score > 0.4 or honeypot_hit:
            self.persistence_score = min(1.0, self.persistence_score + 0.15)
        else:
            self.persistence_score = max(0.0, self.persistence_score - 0.2)
            
        # Store evidence for reporting
        self.last_evidence = {
            "traffic": self.traffic,
            "query_rate": features[0][1],
            "packet_size": features[0][2],
            "dest_count": features[0][3],
            "honeypot_interaction": honeypot_hit
        }

        # Store gradient for FL
        self.gradient = np.array([normalized - self.anomaly_score])

        if self.under_attack and random.random() < 0.04:
            self.under_attack = False
            self.attack_intensity = 0.0

        return self.anomaly_score

    def get_status(self) -> str:
        if getattr(self, "status", None) in ["sanitizing", "health_check", "ready_reconnect"]:
            return self.status
            
        if self.is_isolated: return "isolated"
        s = self.anomaly_score + (self.persistence_score * 0.2)
        if s >= SEVERITY_THRESHOLDS["CRITICAL"]: return "compromised"
        if s >= SEVERITY_THRESHOLDS["HIGH"]:     return "compromised"
        if s >= SEVERITY_THRESHOLDS["MEDIUM"]:   return "suspicious"
        return "normal"

    def get_severity(self) -> Optional[str]:
        if self.is_isolated: return None
        s = self.anomaly_score + (self.persistence_score * 0.2)
        if s >= SEVERITY_THRESHOLDS["CRITICAL"]: return "CRITICAL"
        if s >= SEVERITY_THRESHOLDS["HIGH"]:     return "HIGH"
        if s >= SEVERITY_THRESHOLDS["MEDIUM"]:   return "MEDIUM"
        if s >= SEVERITY_THRESHOLDS["LOW"]:      return "LOW"
        return None

    def get_threat_reason(self) -> str:
        s = self.anomaly_score + (self.persistence_score * 0.2)
        t = self.traffic
        b = self.base_traffic
        
        evidence_str = ""
        if self.last_evidence:
            ev = self.last_evidence
            if ev.get("dest_count", 0) > 3:
                evidence_str += " Unknown destination topics accessed."
            if ev.get("query_rate", 0) < 0.2 and self.under_attack:
                evidence_str += " Unexpected WRITE commands."
            if ev.get("honeypot_interaction", False):
                evidence_str += " **Honeypot probed!**"

        if s < 0.20:
            return f"{self.name} traffic within baseline ({t} req/min). Isolation Forest confidence high."
        if s < 0.35:
            return f"Minor deviation on {self.name}. Traffic at {t} req/min. Monitoring — no action required."
        if s < 0.60:
            return f"Anomalous pattern on {self.name}. Request rate {t/b:.1f}x above baseline.{evidence_str} Persistence score: {self.persistence_score:.2f}."
        
        return f"{self.name} shows strong compromise indicators. Traffic spike {t/b:.1f}x baseline.{evidence_str} Persistent anomaly. Immediate action recommended."

    def get_mqtt_sample(self) -> dict:
        if self.under_attack:
            return {
                "topic":   f"factory/{self.name}/cmd",
                "payload": f"WRITE reg=0x40 val=0xDEAD",
                "type":    "ATTACK",
            }
        return {
            "topic":   f"factory/{self.name}/data",
            "payload": f"traffic={self.traffic} req/min | status=normal",
            "type":    "NORMAL",
        }

    def to_dict(self) -> dict:
        return {
            "id":               self.id,
            "name":             self.name,
            "type":             self.type,
            "status":           self.get_status(),
            "anomalyScore":     round(self.anomaly_score, 4),
            "traffic":          self.traffic,
            "baseTraffic":      self.base_traffic,
            "threatReason":     self.get_threat_reason(),
            "mqttSample":       self.get_mqtt_sample(),
            "position":         self.position,
            "isIsolated":       self.is_isolated,
            "underAttack":      self.under_attack,
            "lastEvidence":     self.last_evidence,
            "persistenceScore": round(self.persistence_score, 2),
        }


class NodeManager:
    """Manages all IoT nodes — real nodes + honeypots."""

    def __init__(self):
        self._active_alerts: dict[str, dict] = {}
        self.broker = MQTTBrokerSimulator()

        self.nodes: dict[str, IoTNode] = {
            "N1": IoTNode("N1", "PLC-01",        "PLC",    120, FIXED_POSITIONS["N1"], self.broker),
            "N2": IoTNode("N2", "Temperature-02", "Sensor",  85, FIXED_POSITIONS["N2"], self.broker),
            "N3": IoTNode("N3", "SCADA-03",       "SCADA",  210, FIXED_POSITIONS["N3"], self.broker),
            "N4": IoTNode("N4", "Pressure-04",    "Sensor",  95, FIXED_POSITIONS["N4"], self.broker),
            "N5": IoTNode("N5", "Motor-Ctrl-05",  "HMI",    145, FIXED_POSITIONS["N5"], self.broker),
            "N6": IoTNode("N6", "PLC-06",         "PLC",    189, FIXED_POSITIONS["N6"], self.broker),
        }

        self.honeypots = [
            {"id": "HP1", "name": "PLC-99 (Honeypot)", "type": "Honeypot",
             "status": "honeypot", "anomalyScore": 0, "traffic": 0,
             "position": {"x": 15, "y": 75},
             "threatReason": "Decoy device — any probe is immediately flagged as hostile."},
            {"id": "HP2", "name": "Sensor-98 (Honeypot)", "type": "Honeypot",
             "status": "honeypot", "anomalyScore": 0, "traffic": 0,
             "position": {"x": 72, "y": 78},
             "threatReason": "Decoy device — any probe is immediately flagged as hostile."},
        ]

    def tick(self) -> list[dict]:
        for node in self.nodes.values():
            node.tick(self.broker)
        return self.get_all_nodes()

    def check_alerts(self) -> list[dict]:
        new_alerts = []
        for node in self.nodes.values():
            if getattr(node, "status", None) in ["sanitizing", "health_check", "ready_reconnect"]:
                continue
            if node.is_isolated:
                continue
            severity = node.get_severity()
            if severity:
                key = f"{node.id}_{severity}"
                if key not in self._active_alerts:
                    alert = {
                        "id":       f"al_{uuid.uuid4().hex[:8]}",
                        "nodeId":   node.id,
                        "node":     node.name,
                        "time":     datetime.utcnow().strftime("%H:%M:%S"),
                        "severity": severity,
                        "reason":   node.get_threat_reason(),
                    }
                    self._active_alerts[key] = alert
                    new_alerts.append(alert)
            else:
                for key in [k for k in list(self._active_alerts.keys()) if k.startswith(node.id)]:
                    del self._active_alerts[key]
        return new_alerts

    def add_node(self, name: str, node_type: str, base_traffic: int = 100) -> dict:
        node_id = f"U{uuid.uuid4().hex[:4].upper()}"
        node = IoTNode(node_id, name, node_type, base_traffic, broker=self.broker)
        self.nodes[node_id] = node
        return node.to_dict()

    def remove_node(self, node_id: str) -> bool:
        if node_id in self.nodes:
            del self.nodes[node_id]
            for key in [k for k in list(self._active_alerts.keys()) if k.startswith(node_id)]:
                del self._active_alerts[key]
            return True
        return False

    def isolate_node(self, node_id: str) -> Optional[dict]:
        node = self.nodes.get(node_id)
        if not node:
            return None
        node.is_isolated = True
        node.status = "isolated"
        for key in [k for k in list(self._active_alerts.keys()) if k.startswith(node_id)]:
            del self._active_alerts[key]
        return {"id": node.id, "name": node.name}

    def restore_node(self, node_id: str) -> bool:
        node = self.nodes.get(node_id)
        if node and node.is_isolated:
            node.is_isolated = False
            node.status = "normal"
            return True
        return False

    def trigger_attack(self, node_id: str, intensity: float = 0.8) -> bool:
        node = self.nodes.get(node_id)
        if not node or node.is_isolated:
            return False
        node.under_attack     = True
        node.attack_intensity = max(0.0, min(1.0, intensity))
        return True

    def approve_isolation(self, alert_id: str):
        for alert in self._active_alerts.values():
            if alert["id"] == alert_id and alert["severity"] == "MEDIUM":
                alert["severity"] = "HIGH"
                break

    def clear_alerts(self):
        self._active_alerts.clear()

    def get_all_nodes(self) -> list[dict]:
        return [n.to_dict() for n in self.nodes.values()] + self.honeypots

    def get_active_alerts(self) -> list[dict]:
        return list(self._active_alerts.values())

    def get_gradients(self) -> dict[str, np.ndarray]:
        return {
            nid: n.gradient
            for nid, n in self.nodes.items()
            if n.gradient is not None and not n.is_isolated
        }

    def set_sanitizing(self, node_id: str):
        node = self.nodes.get(node_id)
        if node: node.status = "sanitizing"

    def set_health_checking(self, node_id: str):
        node = self.nodes.get(node_id)
        if node: node.status = "health_check"

    def set_ready_for_reconnect(self, node_id: str):
        node = self.nodes.get(node_id)
        if node: node.status = "ready_reconnect"

    def reconnect_node(self, node_id: str):
        node = self.nodes.get(node_id)
        if not node or node.status != "ready_reconnect":
            return None
        node.is_isolated = False
        node.status = "normal"
        node.anomaly_score = random.uniform(0.02, 0.08)
        node.persistence_score = 0.0
        return {"id": node.id, "name": node.name}
