"""
CanaryMesh — Honeypot + Cybersecurity Layer

Fake PLC-99 and Sensor-98 sit in the network.
No legitimate device should ever contact them.
Any probe → immediate HIGH alert + attacker fingerprint logged.
"""

import random
import threading
import time
from datetime import datetime

HONEYPOTS = [
    {"id": "HP1", "name": "PLC-99 (Honeypot)",     "port": 1884},
    {"id": "HP2", "name": "Sensor-98 (Honeypot)",  "port": 1885},
]

FAKE_SOURCE_IPS = [
    "192.168.1.104", "10.0.0.53", "172.16.0.88",
    "192.168.2.201", "10.10.0.15", "192.168.99.1",
]

CREDENTIAL_ATTEMPTS = [
    "admin/admin", "root/root", "admin/password",
    "plc/plc123",  "scada/scada", "user/12345",
    "operator/operator", "guest/guest",
]

ATTACK_PATTERNS = [
    "Port scan on MQTT broker",
    "Unexpected WRITE command to register 0x40",
    "Modbus function code 0x08 (Diagnostics) from unknown host",
    "Attempted firmware upload via undocumented endpoint",
    "Repeated authentication failures",
]


class HoneypotServer:
    """
    Runs in a background thread. Randomly simulates attacker probes
    on the honeypot devices at realistic intervals.
    Also supports manual probe triggering for demo purposes.
    """

    def __init__(self, node_manager=None):
        self.node_manager = node_manager
        self._running   = False
        self._thread    = None
        self._queue: list[dict] = []
        self._lock      = threading.Lock()

    def start(self):
        self._running = True
        self._thread  = threading.Thread(target=self._probe_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    def _probe_loop(self):
        """Randomly probe a honeypot every 20–90 seconds."""
        while self._running:
            sleep_time = random.uniform(20, 90)
            time.sleep(sleep_time)
            if not self._running:
                break
            self._generate_probe()

    def _generate_probe(self) -> dict:
        hp    = random.choice(HONEYPOTS)
        event = {
            "honeypot_id":   hp["id"],
            "honeypot_name": hp["name"],
            "source_ip":     random.choice(FAKE_SOURCE_IPS),
            "credentials":   random.choice(CREDENTIAL_ATTEMPTS),
            "attack_pattern": random.choice(ATTACK_PATTERNS),
            "timestamp":     datetime.utcnow().isoformat(),
        }
        with self._lock:
            self._queue.append(event)
        return event

    def manual_probe(self) -> dict:
        """Trigger a probe immediately (for demo / testing)."""
        return self._generate_probe()

    def check_probes(self) -> list[dict]:
        """Drain and return all pending probe events."""
        with self._lock:
            events         = list(self._queue)
            self._queue.clear()
        return events
