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
from typing import Callable


@dataclass
class MQTTMessage:
    topic:     str
    payload:   str
    node_id:   str
    node_name: str
    timestamp: str = field(default_factory=lambda: datetime.utcnow().strftime("%H:%M:%S"))
    is_attack: bool = False


class MQTTBrokerSimulator:
    """
    In-process MQTT broker simulation.
    Produces realistic publish streams for each node.
    """

    NORMAL_PAYLOADS = {
        "PLC":    ["temp={t}C status=RUN",    "pressure={p}bar mode=AUTO",   "cycle_count={c}"],
        "Sensor": ["value={v} unit=degC",     "reading={r} quality=GOOD",    "alert=NONE"],
        "SCADA":  ["cmd=POLL_STATUS",          "hmi_sync=OK",                 "alarm_count=0"],
        "HMI":    ["operator_input=NONE",      "screen=MAIN display=OK",      "session=active"],
    }

    ATTACK_PAYLOADS = [
        "cmd=UNKNOWN_0xFF",
        "dest=192.168.99.1 payload=SCAN",
        "WRITE reg=0x40 val=0xDEAD",
        "FUZZ " * 50,
        "cmd=FIRMWARE_UPLOAD src=unknown",
        "broadcast=ALL cmd=SHUTDOWN",
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
                         node_type: str, under_attack: bool = False) -> MQTTMessage:
        topic = f"factory/{node_name}/data"
        if under_attack:
            payload = random.choice(self.ATTACK_PAYLOADS)
        else:
            templates = self.NORMAL_PAYLOADS.get(node_type, ["status=OK"])
            tpl = random.choice(templates)
            payload = tpl.format(
                t=round(random.uniform(30, 90), 1),
                p=round(random.uniform(1, 10), 2),
                c=random.randint(1000, 9999),
                v=round(random.uniform(20, 80), 2),
                r=round(random.uniform(15, 75), 1),
            )
        return MQTTMessage(
            topic=topic, payload=payload,
            node_id=node_id, node_name=node_name,
            is_attack=under_attack,
        )
