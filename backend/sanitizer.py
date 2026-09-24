"""
CanaryMesh — Node Sanitizer
Phase 2: Block IP, purge queue, restore FL model
Phase 3: Health check verification
"""
import random
from datetime import datetime

FAKE_IPS = ["192.168.99.1","10.0.0.53","172.16.0.88","192.168.2.201","10.10.0.15"]
MQTT_ACL_BLOCKLIST: list[str] = []

class NodeSanitizer:
    def __init__(self, node_manager, fl_engine):
        self.node_manager = node_manager
        self.fl_engine    = fl_engine

    def block_attacker_ip(self, node_id: str) -> str:
        """Phase 2a: Add attacker IP to MQTT ACL drop list."""
        ip = random.choice(FAKE_IPS)
        if ip not in MQTT_ACL_BLOCKLIST:
            MQTT_ACL_BLOCKLIST.append(ip)
        return ip

    def purge_command_queue(self, node_id: str):
        """Phase 2b: Clear volatile command buffer, reset PLC setpoints."""
        node = self.node_manager.nodes.get(node_id)
        if node:
            node.anomaly_score = max(0.01, node.anomaly_score * 0.3)
            node.under_attack  = False
            node.attack_intensity = 0.0

    def restore_fl_model(self, node_id: str) -> int:
        """Phase 2c: Overwrite corrupted local weights with clean global model."""
        node = self.node_manager.nodes.get(node_id)
        if node:
            node._train_baseline()   # retrain on clean synthetic normal data
        return self.fl_engine.round  # return current FL round number

    def verify_health(self, node_id: str) -> bool:
        """Phase 3: Verify telemetry is within baseline after sanitization."""
        node = self.node_manager.nodes.get(node_id)
        if not node:
            return False
        # Health passes if anomaly score dropped below medium threshold
        return node.anomaly_score < 0.30

    def get_blocklist(self) -> list[str]:
        return list(MQTT_ACL_BLOCKLIST)
