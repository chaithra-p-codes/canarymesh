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
            if self.fl_engine.global_params is not None:
                # Apply true federated learning offset
                node.apply_global_model(self.fl_engine.global_params[0])
            else:
                # Fallback if FL hasn't produced a model yet
                node._train_baseline(self.node_manager.broker)
                
            node.persistence_score = 0.0
            node.anomaly_score = 0.05
        return self.fl_engine.round  # return current FL round number

    def verify_health(self, node_id: str) -> bool:
        """Phase 3: Verify telemetry is within baseline after sanitization."""
        node = self.node_manager.nodes.get(node_id)
        if not node:
            return False
            
        ev = node.last_evidence
        
        # Check specific telemetry markers rather than just anomaly score
        traffic_ok = (node.base_traffic * 0.7) <= node.traffic <= (node.base_traffic * 1.3)
        dests_ok = ev.get("dest_count", 0) <= 3
        no_honeypot = not ev.get("honeypot_interaction", False)
        score_ok = node.anomaly_score < 0.35
        
        return traffic_ok and dests_ok and no_honeypot and score_ok

    def get_blocklist(self) -> list[str]:
        return list(MQTT_ACL_BLOCKLIST)