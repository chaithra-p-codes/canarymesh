"""
CanaryMesh — MQTT Traffic Simulator

Simulates the MQTT publish/subscribe layer used by industrial devices.
In production this would talk to a real Mosquitto broker.
For the hackathon demo we simulate the broker in-process.

Each node publishes to:
  factory/<node_name>/data    — sensor readings / PLC status
  factory/<node_name>/cmd     — command channel (monitored for unexpected cmds)
  factory/<node_name>/status  — heartbeat

The system monitors:
  - Request frequency (spike = anomaly)
  - Unexpected command codes
  - Unknown destination topics
  - Cross-node lateral movement attempts
"""

import random
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Optional


@dataclass
class MQTTMessage:
    topic:       str
    payload:     str
    source_id:   str
    source_name: str
    destination: str
    command:     str
    msg_type:    str
    timestamp:   str = field(default_factory=lambda: datetime.utcnow().strftime("%H:%M:%S"))
    is_attack:   bool = False


class MQTTBrokerSimulator:
    """
    In-process MQTT broker simulation.
    Produces realistic publish streams for each node.
    """

    NORMAL_PAYLOADS = {
        "PLC":    [("temp={t}C status=RUN", "READ", "data"), ("pressure={p}bar mode=AUTO", "READ", "data"), ("cycle_count={c}", "READ", "data"), ("set_mode=AUTO", "WRITE", "cmd")],
        "Sensor": [("value={v} unit=degC", "READ", "data"), ("reading={r} quality=GOOD", "READ", "data"), ("alert=NONE", "READ", "status")],
        "SCADA":  [("cmd=POLL_STATUS", "READ", "cmd"), ("hmi_sync=OK", "READ", "status"), ("alarm_count=0", "READ", "data"), ("update_setpoint={v}", "WRITE", "cmd")],
        "HMI":    [("operator_input=NONE", "READ", "status"), ("screen=MAIN display=OK", "READ", "status"), ("session=active", "READ", "status"), ("manual_override=ON", "WRITE", "cmd")],
    }

    ATTACK_PAYLOADS = [
        ("cmd=UNKNOWN_0xFF", "UNKNOWN", "cmd"),
        ("dest=192.168.99.1 payload=SCAN", "SCAN", "cmd"),
        ("WRITE reg=0x40 val=0xDEAD", "WRITE", "cmd"),
        ("FUZZ " * 50, "FUZZ", "data"),
        ("cmd=FIRMWARE_UPLOAD src=unknown", "FIRMWARE_UPLOAD", "cmd"),
        ("broadcast=ALL cmd=SHUTDOWN", "SHUTDOWN", "cmd"),
    ]

    def __init__(self):
        self._subscribers: dict[str, list[Callable]] = {}

    def subscribe(self, topic_pattern: str, callback: Callable):
        self._subscribers.setdefault(topic_pattern, []).append(callback)

    def publish(self, msg: MQTTMessage):
        for pattern, callbacks in self._subscribers.items():
            if self._matches(pattern, msg.topic):
                for cb in callbacks:
                    cb(msg)

    def _matches(self, pattern: str, topic: str) -> bool:
        if pattern == "#":
            return True
        if pattern.endswith("/#"):
            return topic.startswith(pattern[:-2])
        return pattern == topic

    def generate_message(self, node_id: str, node_name: str,
                         node_type: str, under_attack: bool = False, allowed_peers: list = None) -> MQTTMessage:
        if allowed_peers is None:
            allowed_peers = ["SCADA-03", "Gateway"]
            
        topic = f"factory/{node_name}/data"
        if under_attack:
            payload, cmd, msg_type = random.choice(self.ATTACK_PAYLOADS)
            destination = "BROADCAST" if cmd == "SHUTDOWN" else "UNKNOWN_IP"
            topic = f"factory/{node_name}/{msg_type}"
        else:
            templates = self.NORMAL_PAYLOADS.get(node_type, [("status=OK", "READ", "status")])
            tpl, cmd, msg_type = random.choice(templates)
            topic = f"factory/{node_name}/{msg_type}"
            payload = tpl.format(
                t=round(random.uniform(30, 90), 1),
                p=round(random.uniform(1, 10), 2),
                c=random.randint(1000, 9999),
                v=round(random.uniform(20, 80), 2),
                r=round(random.uniform(15, 75), 1),
            )
            destination = random.choice(allowed_peers) if allowed_peers else "BROADCAST"

        return MQTTMessage(
            topic=topic, 
            payload=payload,
            source_id=node_id, 
            source_name=node_name,
            destination=destination,
            command=cmd,
            msg_type=msg_type,
            is_attack=under_attack,
        )