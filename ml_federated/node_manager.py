"""
CanaryMesh — Node Manager
Manages all IoT nodes. Each node runs a local Isolation Forest
anomaly detection model. Raw data never leaves the node.
"""

import random
import uuid
from datetime import datetime
from typing import Optional

import numpy as np
from sklearn.ensemble import IsolationForest

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
    Simulates MQTT traffic patterns for:
      - Normal operation
      - Under attack (triggered externally)
    """

    def __init__(self, node_id: str, name: str, node_type: str,
                 base_traffic: int = 100, position: dict = None):
        self.id           = node_id
        self.name         = name
        self.type         = node_type
        self.is_isolated  = False
        self.under_attack = False
        self.attack_intensity = 0.0

        # Unique per-node baseline (simulates device fingerprint)
        self.base_traffic      = base_traffic
        self.base_query_rate   = random.uniform(0.85, 1.15)
        self.base_packet_size  = random.uniform(0.90, 1.10)
        self.base_port_div     = random.uniform(0.88, 1.12)

        self.anomaly_score = random.uniform(0.03, 0.10)
        self.traffic       = base_traffic
        self.gradient: Optional[np.ndarray] = None

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
        self._train_baseline()

    def _train_baseline(self):
        """Generate 300 normal samples and fit local Isolation Forest."""
        normal = np.column_stack([
            np.random.normal(self.base_traffic,     10,   300),
            np.random.normal(self.base_query_rate,  0.05, 300),
            np.random.normal(self.base_packet_size, 0.04, 300),
            np.random.normal(self.base_port_div,    0.06, 300),
        ])
        self.model.fit(normal)

    def _mqtt_features(self) -> np.ndarray:
        """
        Generate current MQTT traffic feature vector.
        Under attack: traffic spikes, unexpected ports, small packets.
        Normal: Gaussian noise around baseline.
        """
        if self.under_attack:
            i = self.attack_intensity
            traffic     = self.base_traffic    * (1 + i * random.uniform(2.5, 4.5))
            query_rate  = self.base_query_rate * (1 + i * random.uniform(3.0, 6.0))
            packet_size = self.base_packet_size * random.uniform(0.2, 0.6)
            port_div    = self.base_port_div   * (1 + i * random.uniform(5.0, 10.0))
        else:
            traffic     = self.base_traffic    * (1 + random.gauss(0, 0.08))
            query_rate  = self.base_query_rate * (1 + random.gauss(0, 0.04))
            packet_size = self.base_packet_size * (1 + random.gauss(0, 0.03))
            port_div    = self.base_port_div   * (1 + random.gauss(0, 0.05))

        return np.array([[traffic, query_rate, packet_size, port_div]])

    def tick(self) -> float:
        """
        One simulation step:
        1. Generate MQTT feature vector
        2. Score with local Isolation Forest
        3. Return normalised anomaly score (0 = normal, 1 = highly anomalous)
        """
        if self.is_isolated:
            return self.anomaly_score

        features = self._mqtt_features()
        raw = self.model.decision_function(features)[0]          # higher = more normal
        normalized = float(np.clip((0.2 - raw) / 0.4, 0.0, 1.0))

        # Exponential smoothing to avoid jitter
        self.anomaly_score = self.anomaly_score * 0.55 + normalized * 0.45
        self.traffic       = max(20, int(features[0][0]))

        # Store gradient for FL (score delta as simplified 1D update)
        self.gradient = np.array([normalized - self.anomaly_score])

        # Random drift off attack if not manually set
        if self.under_attack and random.random() < 0.04:
            self.under_attack    = False
            self.attack_intensity = 0.0

        return self.anomaly_score

    def get_status(self) -> str:
        if self.is_isolated:      return "isolated"
        s = self.anomaly_score
        if s >= SEVERITY_THRESHOLDS["CRITICAL"]: return "compromised"
        if s >= SEVERITY_THRESHOLDS["HIGH"]:     return "compromised"
        if s >= SEVERITY_THRESHOLDS["MEDIUM"]:   return "suspicious"
        return "normal"

    def get_severity(self) -> Optional[str]:
        s = self.anomaly_score
        if s >= SEVERITY_THRESHOLDS["CRITICAL"]: return "CRITICAL"
        if s >= SEVERITY_THRESHOLDS["HIGH"]:     return "HIGH"
        if s >= SEVERITY_THRESHOLDS["MEDIUM"]:   return "MEDIUM"
        if s >= SEVERITY_THRESHOLDS["LOW"]:      return "LOW"
        return None

    def get_threat_reason(self) -> str:
        s = self.anomaly_score
        t = self.traffic
        b = self.base_traffic
        if s < 0.20:
            return (f"{self.name} traffic patterns are within normal baseline "
                    f"({t} req/min ≈ expected {b}). Isolation Forest confidence high.")
        if s < 0.35:
            return (f"Minor deviation on {self.name}. Traffic at {t} req/min "
                    f"(baseline {b}). Monitoring — no action required.")
        if s < 0.60:
            return (f"Anomalous packet timing on {self.name}. "
                    f"Request rate {t/b:.1f}× above baseline. "
                    f"Port diversity outside normal range. Monitoring recommended.")
        return (f"{self.name} shows strong compromise indicators. "
                f"Traffic spike {t/b:.1f}× baseline with unexpected command patterns. "
                f"Lateral movement risk. Immediate isolation recommended.")

    def get_mqtt_sample(self) -> dict:
        """Return a human-readable MQTT message sample for the dashboard."""
        if self.under_attack:
            return {
                "topic":   f"factory/{self.name}/data",
                "payload": f"500 requests/s | unexpected_cmd | unknown_dest",
                "type":    "ATTACK",
            }
        return {
            "topic":   f"factory/{self.name}/data",
            "payload": f"traffic={self.traffic} req/min | status=normal",
            "type":    "NORMAL",
        }

    def to_dict(self) -> dict:
        return {
            "id":           self.id,
            "name":         self.name,
            "type":         self.type,
            "status":       self.get_status(),
            "anomalyScore": round(self.anomaly_score, 4),
            "traffic":      self.traffic,
            "baseTraffic":  self.base_traffic,
            "threatReason": self.get_threat_reason(),
            "mqttSample":   self.get_mqtt_sample(),
            "position":     self.position,
            "isIsolated":   self.is_isolated,
            "underAttack":  self.under_attack,
        }


class NodeManager:
    """Manages all IoT nodes — real nodes + honeypots."""

    def __init__(self):
        self._active_alerts: dict[str, dict] = {}

        # Default 6 industrial nodes
        self.nodes: dict[str, IoTNode] = {
            "N1": IoTNode("N1", "PLC-01",        "PLC",    120, FIXED_POSITIONS["N1"]),
            "N2": IoTNode("N2", "Temperature-02", "Sensor",  85, FIXED_POSITIONS["N2"]),
            "N3": IoTNode("N3", "SCADA-03",       "SCADA",  210, FIXED_POSITIONS["N3"]),
            "N4": IoTNode("N4", "Pressure-04",    "Sensor",  95, FIXED_POSITIONS["N4"]),
            "N5": IoTNode("N5", "Motor-Ctrl-05",  "HMI",    145, FIXED_POSITIONS["N5"]),
            "N6": IoTNode("N6", "PLC-06",         "PLC",    189, FIXED_POSITIONS["N6"]),
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

    # ── Simulation tick ───────────────────────────────────────────────────────
    def tick(self) -> list[dict]:
        for node in self.nodes.values():
            node.tick()
        return self.get_all_nodes()

    # ── Alert detection ───────────────────────────────────────────────────────
    def check_alerts(self) -> list[dict]:
        new_alerts = []
        for node in self.nodes.values():
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
                for key in [k for k in self._active_alerts if k.startswith(node.id)]:
                    del self._active_alerts[key]
        return new_alerts

    # ── Node CRUD ─────────────────────────────────────────────────────────────
    def add_node(self, name: str, node_type: str, base_traffic: int = 100) -> dict:
        """Add a custom node (e.g. user-defined PLC or Sensor)."""
        node_id = f"U{uuid.uuid4().hex[:4].upper()}"
        node = IoTNode(node_id, name, node_type, base_traffic)
        self.nodes[node_id] = node
        return node.to_dict()

    def remove_node(self, node_id: str) -> bool:
        if node_id in self.nodes:
            del self.nodes[node_id]
            for key in [k for k in self._active_alerts if k.startswith(node_id)]:
                del self._active_alerts[key]
            return True
        return False

    def isolate_node(self, node_id: str) -> Optional[dict]:
        node = self.nodes.get(node_id)
        if not node:
            return None
        node.is_isolated = True
        for key in [k for k in self._active_alerts if k.startswith(node_id)]:
            del self._active_alerts[key]
        return {"id": node.id, "name": node.name}

    def restore_node(self, node_id: str) -> bool:
        node = self.nodes.get(node_id)
        if node and node.is_isolated:
            node.is_isolated = False
            return True
        return False

    def trigger_attack(self, node_id: str, intensity: float = 0.8) -> bool:
        """Manually trigger a simulated attack on a node."""
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

    # ── Sanitization state machine ────────────────────────────────────────────
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
        return {"id": node.id, "name": node.name}
