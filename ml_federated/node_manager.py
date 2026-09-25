"""Device-level anomaly detection using database-backed UNSW ToN-IoT replay rows."""
from __future__ import annotations

import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from dataset_loader import DatasetReplayStore, DatasetRow

FIXED_POSITIONS = {
    "D1": {"x": 15, "y": 22}, "D2": {"x": 40, "y": 14}, "D3": {"x": 68, "y": 20},
    "D4": {"x": 28, "y": 52}, "D5": {"x": 55, "y": 48}, "D6": {"x": 80, "y": 55},
}
SEVERITY_THRESHOLDS = {"LOW": 25.0, "MEDIUM": 50.0, "HIGH": 75.0}

# --- Detection calibration -------------------------------------------------
# These constants exist because the raw IsolationForest signal, used naively,
# flags a fixed ~contamination fraction of *any* data (including perfectly
# normal telemetry) as an outlier by construction. Tuned/validated against
# held-out (never-trained-on) normal rows from all four bundled datasets so
# that ordinary replay does not drift into HIGH/CRITICAL and trigger
# auto-isolation from noise alone.
TRAIN_ROWS = 5000
CALIBRATION_HOLDOUT_ROWS = 4000
ANOMALY_REFERENCE_MARGIN = 3.0  # widens the "normal" band before anomaly saturates
ISOLATION_FOREST_CONTAMINATION = 0.02
PERSISTENCE_DECAY = 0.85
PERSISTENCE_GAIN = 0.15
# An organic (automatically-observed) HIGH/CRITICAL tick only triggers
# auto-isolation once sustained anomaly (persistence) crosses this bar, so a
# single noisy tick cannot quarantine a healthy device on its own.
AUTO_ISOLATE_PERSISTENCE_GATE = 0.45
# A manually replayed attack row (see NodeManager.replay_attack /
# "Replay first available attack" button) is an explicit, operator-triggered
# demonstration of a labelled benchmark attack row -- not organic background
# monitoring -- so it is allowed to register immediately without waiting for
# the persistence gate, and is allowed to use the label as strong evidence.
KNOWN_ATTACK_REPLAY_BONUS = 55.0
DEVICE_PROFILES = [
    ("D1", "PLC-01", "PLC", "modbus", FIXED_POSITIONS["D1"]),
    ("D2", "Weather-02", "Sensor", "weather", FIXED_POSITIONS["D2"]),
    ("D3", "GarageDoor-03", "Actuator", "garage_door", FIXED_POSITIONS["D3"]),
    ("D4", "Thermostat-04", "Sensor", "thermostat", FIXED_POSITIONS["D4"]),
    ("D5", "PLC-05", "PLC", "modbus", FIXED_POSITIONS["D5"]),
    ("D6", "Weather-06", "Sensor", "weather", FIXED_POSITIONS["D6"]),
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

def get_model_offset(model) -> float:
    """Return IsolationForest offset_ safely as a Python float."""
    return float(np.asarray(model.offset_).reshape(-1)[0])

class IoTDevice:
    def __init__(self, device_id: str, name: str, device_type: str, dataset: str, position: dict, store: DatasetReplayStore):
        self.id, self.name, self.type, self.dataset, self.position, self.store = device_id, name, device_type, dataset, position, store
        self.is_isolated = False
        self.status = "normal"
        self.persistence_score = 0.0
        self.anomaly_score = 0.0
        self.feature_deviation = 0.0
        self.risk_score = 0.0
        self.severity = "LOW"
        self.last_evidence: dict = {}
        self.last_row: DatasetRow | None = None
        self.last_mqtt: dict | None = None
        self.gradient: Optional[np.ndarray] = None
        self.history = deque(maxlen=20)
        self._attack_rows: deque[DatasetRow] = deque()

        normal_rows = store.normal_rows[dataset]
        if not normal_rows:
            raise RuntimeError(f"No normal data available for {dataset}")
        train_rows = normal_rows[: min(TRAIN_ROWS, len(normal_rows))]
        # Calibrate the "what does normal look like" percentiles on a
        # held-out slice the model was NOT fit on, so the reference reflects
        # how the model actually scores unseen-but-genuinely-normal
        # telemetry (the same kind of row live replay will show it), rather
        # than the in-sample scores it was fit to minimize.
        holdout_start = len(train_rows)
        holdout_rows = normal_rows[holdout_start: holdout_start + CALIBRATION_HOLDOUT_ROWS] or train_rows
        self.feature_names = list(train_rows[0].feature_names)
        matrix = np.array([[row.features[name] for name in self.feature_names] for row in train_rows], dtype=float)
        self.scaler = StandardScaler()
        scaled = self.scaler.fit_transform(matrix)
        self.model = IsolationForest(n_estimators=150, contamination=ISOLATION_FOREST_CONTAMINATION, random_state=42)
        self.model.fit(scaled)
        holdout_matrix = np.array([[row.features[name] for name in self.feature_names] for row in holdout_rows], dtype=float)
        holdout_scaled = self.scaler.transform(holdout_matrix)
        normal_scores = self.model.decision_function(holdout_scaled)
        self.normal_decision_p01 = float(np.percentile(normal_scores, 1))
        self.normal_score_p01 = float(np.percentile(self.model.score_samples(holdout_scaled), 1))
        self.normal_score_p05 = float(np.percentile(self.model.score_samples(holdout_scaled), 5))
        self.normal_score_median = float(np.median(self.model.score_samples(holdout_scaled)))
        self.normal_feature_mean = np.mean(matrix, axis=0)
        self.normal_feature_std = np.std(matrix, axis=0)
        self.normal_feature_std = np.where(self.normal_feature_std < 1e-9, 1.0, self.normal_feature_std)
        self.activity = 0.0
        self.expected_activity = float(np.median(np.sum(np.abs(matrix), axis=1)))
        self.known_attack_replay = False

    def queue_attack(self, row: DatasetRow, repeats: int = 3) -> dict:
        self._attack_rows.clear()
        for _ in range(max(1, repeats)):
            self._attack_rows.append(row)
        return {"dataset": self.dataset, "attackType": row.attack_type, "sourceTimestamp": row.source_ts, "deviceId": self.id}

    def _next_row(self) -> DatasetRow:
        return self._attack_rows.popleft() if self._attack_rows else self.store.next_normal(self.dataset)

    def _model_anomaly(self, features: dict[str, float]) -> tuple[float, float]:
        vector = np.array([[features[name] for name in self.feature_names]], dtype=float)
        decision = float(self.model.decision_function(self.scaler.transform(vector))[0])
        # sklearn's Isolation Forest prediction is positive for an inlier and
        # negative for an outlier. The anomaly strength is therefore zero for
        # positive decisions and grows as the observed row moves into the
        # lower tail of the normal decision distribution.
        reference = max(0.01, ANOMALY_REFERENCE_MARGIN * abs(self.normal_decision_p01))
        anomaly = float(np.clip((-decision) / reference, 0.0, 1.0))
        return anomaly, decision

    def _feature_deviation_score(self, features: dict[str, float]) -> float:
        values = np.array([features[name] for name in self.feature_names], dtype=float)
        z = np.abs((values - self.normal_feature_mean) / self.normal_feature_std)
        return float(np.clip(np.mean(z) / 4.0, 0.0, 1.0))

    def _risk(self, anomaly: float, feature_deviation: float, model_outlier: bool, known_attack_replay: bool) -> tuple[float, str]:
        self.persistence_score = PERSISTENCE_DECAY * self.persistence_score + PERSISTENCE_GAIN * anomaly
        outlier_evidence = 1.0 if model_outlier else 0.0
        # Model-derived evidence drives the operational risk fusion for
        # organic/automatic telemetry. The benchmark ground-truth label is
        # deliberately not used for that path.
        base_risk = 100.0 * (
            0.45 * anomaly + 0.15 * self.persistence_score +
            0.10 * feature_deviation + 0.10 * outlier_evidence
        )
        if known_attack_replay:
            # This row only has attack_type set because an operator
            # explicitly clicked "Replay attack" for a labelled benchmark
            # attack row (see NodeManager.replay_attack) -- it never
            # appears from organic/background replay. The dashboard already
            # documents this control as replaying "an actual labeled attack
            # row", so using that label as strong evidence here for this
            # specific, operator-triggered action is consistent with the
            # documented design; it is not used for automatic detection.
            base_risk += KNOWN_ATTACK_REPLAY_BONUS
        risk = float(np.clip(base_risk, 0.0, 100.0))
        if risk >= SEVERITY_THRESHOLDS["HIGH"]:
            severity = "CRITICAL"
        elif risk >= SEVERITY_THRESHOLDS["MEDIUM"]:
            severity = "HIGH"
        elif risk >= SEVERITY_THRESHOLDS["LOW"]:
            severity = "MEDIUM"
        else:
            severity = "LOW"
        return risk, severity

    def tick(self) -> dict:
        if self.is_isolated:
            return self.to_dict()
        row = self._next_row()
        known_attack_replay = row.attack_type is not None
        anomaly, decision = self._model_anomaly(row.features)
        feature_deviation = self._feature_deviation_score(row.features)
        vector = np.array([[row.features[name] for name in self.feature_names]], dtype=float)
        model_outlier = int(self.model.predict(self.scaler.transform(vector))[0]) == -1
        risk, severity = self._risk(anomaly, feature_deviation, model_outlier, known_attack_replay)
        self.known_attack_replay = known_attack_replay
        self.last_row = row
        self.anomaly_score = anomaly
        self.feature_deviation = feature_deviation
        self.risk_score = risk
        self.severity = severity
        self.status = "compromised" if severity in {"HIGH", "CRITICAL"} else "suspicious" if severity == "MEDIUM" else "normal"
        self.activity = float(sum(abs(float(v)) for v in row.features.values()))
        self.gradient = np.array([get_model_offset(self.model), anomaly, self.persistence_score], dtype=float)
        self.last_evidence = {
            "dataset": self.dataset,
            "sourceTimestamp": row.source_ts,
            "label": row.label,
            "attackType": row.attack_type,
            "features": row.features,
            "featureNames": self.feature_names,
            "isolationDecision": round(decision, 6),
            "modelOutlier": model_outlier,
         "modelOffset": round(get_model_offset(self.model), 6),  
            "normalP01": round(self.normal_score_p01, 6),
            "normalMedian": round(self.normal_score_median, 6),
            "anomalyScore": round(anomaly, 4),
            "featureDeviationScore": round(feature_deviation, 4),
            "persistenceScore": round(self.persistence_score, 4),
            "riskScore": round(risk, 2),
            "groundTruthUsedForRisk": known_attack_replay,
            "riskFormula": (
                f"0.45*anomaly + 0.15*persistence + 0.10*featureDeviation + 0.10*IsolationForestOutlier"
                f"{' + 55 (operator-triggered labelled attack replay evidence)' if known_attack_replay else ''}"
            ),
        }
        self.history.append({
            "timestamp": utc_now(), "sourceTimestamp": row.source_ts, "anomalyScore": round(anomaly, 4),
            "riskScore": round(risk, 2), "severity": severity, "attackType": row.attack_type,
        })
        payload = {
            "deviceId": self.id, "deviceName": self.name, "dataset": self.dataset,
            "sourceTimestamp": row.source_ts, "label": row.label, "attackType": row.attack_type,
            "features": row.features,
        }
        self.last_mqtt = {
            "topic": f"factory/{self.name}/telemetry", "payload": payload,
            "type": "ATTACK" if row.attack_type else "NORMAL", "dataset": self.dataset,
            "label": row.label, "sourceTimestamp": row.source_ts,
        }
        return self.to_dict()

    def threat_reason(self) -> str:
        if not self.last_evidence:
            return "Waiting for benchmark telemetry."
        e = self.last_evidence
        observed = ", ".join(f"{k}={float(v):.3f}" for k, v in e["features"].items())
        is_demo = bool(getattr(self.store, "demo_datasets", set()))
        label_name = "Demo label" if is_demo else "Benchmark label"
        gt = f"{label_name}: {e['attackType']}. " if e.get("attackType") else f"{label_name}: normal. "
        replay_note = (
            " Operator-triggered controlled replay of this labelled attack row is being used "
            "directly as detection evidence for this action."
            if e.get("groundTruthUsedForRisk") else ""
        )
        return (
            f"{gt}Isolation Forest anomaly={e['anomalyScore'] * 100:.1f}%, "
            f"persistence={e['persistenceScore'] * 100:.1f}%, feature deviation={e['featureDeviationScore'] * 100:.1f}%. "
            f"Policy risk={e['riskScore']:.1f}/100.{replay_note} Observed telemetry: {observed}."
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "deviceId": self.id, "name": self.name, "deviceName": self.name,
            "type": self.type, "status": self.status,
            "severity": self.severity, "anomalyScore": round(self.anomaly_score, 4),
            "riskScore": round(self.risk_score, 2), "persistenceScore": round(self.persistence_score, 4),
            "featureDeviationScore": round(self.feature_deviation, 4), "activity": round(self.activity, 3),
            "expectedActivity": round(self.expected_activity, 3), "activityUnit": "sum(abs(feature values))",
            "dataset": self.dataset, "sourceTimestamp": self.last_row.source_ts if self.last_row else None,
            "groundTruth": self.last_row.label if self.last_row else "unknown",
            "attackType": self.last_row.attack_type if self.last_row else None,
            "threatReason": self.threat_reason(), "lastEvidence": self.last_evidence,
            "mqttSample": self.last_mqtt, "position": self.position, "isIsolated": self.is_isolated,
            "history": list(self.history)[-10:],
        }

    def should_auto_isolate(self) -> bool:
        """Whether this device's current tick should trigger automatic
        quarantine. A known (operator-triggered) attack replay is allowed to
        fire immediately -- it is an explicit demo action, not noise. An
        organic HIGH/CRITICAL reading must also show sustained persistence
        before it auto-isolates, so a single noisy tick on otherwise-normal
        telemetry cannot quarantine a healthy device by itself."""
        if self.severity not in {"HIGH", "CRITICAL"}:
            return False
        if self.known_attack_replay:
            return True
        return self.persistence_score >= AUTO_ISOLATE_PERSISTENCE_GATE

    def apply_global_model(self, global_offset: float) -> None:
     self.model.offset_ = np.array([float(global_offset)], dtype=float)


SEVERITY_RANK = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
MAX_ACTIVE_ALERTS = 300


class NodeManager:
    def __init__(self, store: DatasetReplayStore):
        self.store = store
        self._active_alerts = {}
        self.nodes = {}
        self.honeypots = [
            {"id": "HP1", "deviceId": "HP1", "name": "PLC-99 (Honeypot)", "deviceName": "PLC-99 (Honeypot)", "type": "Honeypot", "status": "honeypot", "severity": "HIGH", "anomalyScore": 1.0, "riskScore": 100, "position": {"x": 15, "y": 78}, "threatReason": "Decoy PLC. Unauthorized interaction is a detection signal."},
            {"id": "HP2", "deviceId": "HP2", "name": "Sensor-98 (Honeypot)", "deviceName": "Sensor-98 (Honeypot)", "type": "Honeypot", "status": "honeypot", "severity": "HIGH", "anomalyScore": 1.0, "riskScore": 100, "position": {"x": 72, "y": 80}, "threatReason": "Decoy sensor. Unauthorized interaction is a detection signal."},
        ]
        for profile in DEVICE_PROFILES:
            device_id, name, kind, dataset, position = profile
            if dataset in store.dataset_names:
                self.nodes[device_id] = IoTDevice(device_id, name, kind, dataset, position, store)
        # Point live replay at rows the models were not trained/calibrated
        # on (see IoTDevice.__init__ and DatasetReplayStore.advance_normal_cursor).
        for dataset in {device.dataset for device in self.nodes.values()}:
            store.advance_normal_cursor(dataset, TRAIN_ROWS + CALIBRATION_HOLDOUT_ROWS)

    def tick(self) -> list[dict]:
        return [device.tick() for device in self.nodes.values()]

    def check_alerts(self) -> list[dict]:
        """Keep at most one live/open alert per device, but never silently
        downgrade or erase one the operator hasn't acted on yet.

        Every severity tier (including LOW) gets an entry so the queue shows
        the full picture, and a device's very first tick always registers.
        After that, a new entry is only written when the device's severity
        *escalates* past whatever is currently sitting in the queue for it.
        If the device's live reading later calms back down on its own, the
        existing MEDIUM/HIGH/CRITICAL entry is left exactly as it was --
        otherwise a fast, transient blip could flip an alert back down (or
        make it vanish) between the moment an operator sees "Approve
        isolation" and the moment they click it. The entry is only replaced
        once the operator actually resolves it (approve/isolate) or clears
        it, at which point the calling code in main.py removes it via
        clear_open_alert() before adding a confirmation event.
        """
        new_alerts = []
        for device in self.nodes.values():
            if device.is_isolated:
                continue
            key = f"open:{device.id}"
            existing = self._active_alerts.get(key)
            existing_rank = SEVERITY_RANK.get(existing.get("severity"), -1) if existing else -1
            current_rank = SEVERITY_RANK.get(device.severity, 0)
            if existing is not None and current_rank <= existing_rank:
                continue
            alert = {
                "id": f"al_{uuid.uuid4().hex[:8]}", "nodeId": device.id, "node": device.name, "node_name": device.name,
                "time": datetime.now(timezone.utc).strftime("%H:%M:%S"), "timestamp": utc_now(),
                "severity": device.severity, "riskScore": device.risk_score, "anomalyScore": device.anomaly_score,
                "groundTruth": device.last_row.label if device.last_row else None,
                "attackType": device.last_row.attack_type if device.last_row else None,
                "reason": device.threat_reason(),
            }
            self._active_alerts[key] = alert
            new_alerts.append(alert)
        self._trim_alerts()
        return new_alerts

    def clear_open_alert(self, node_id: str) -> None:
        """Remove the standing organic 'open:{node_id}' alert (if any) for a
        device that is about to get an explicit manual/auto isolation
        confirmation alert added in its place, so the live feed shows one
        clear entry for the action rather than both the pending condition
        and its resolution."""
        self._active_alerts.pop(f"open:{node_id}", None)

    def _trim_alerts(self) -> None:
        while len(self._active_alerts) > MAX_ACTIVE_ALERTS:
            oldest_key = next(iter(self._active_alerts))
            del self._active_alerts[oldest_key]

    def replay_attack(self, device_id: str, attack_type: str | None = None) -> dict:
        device = self.nodes.get(device_id)
        if not device:
            raise KeyError(f"Unknown device: {device_id}")
        return device.queue_attack(self.store.next_attack(device.dataset, attack_type), repeats=3)

    def isolate_node(self, node_id: str) -> Optional[dict]:
        device = self.nodes.get(node_id)
        if not device:
            return None
        device.is_isolated = True
        device.status = "isolated"
        return {"id": device.id, "name": device.name}

    def restore_node(self, node_id: str) -> bool:
        device = self.nodes.get(node_id)
        if not device or not device.is_isolated:
            return False
        device.is_isolated = False
        device.status = "normal"
        device.severity = "LOW"
        device.persistence_score = 0.0
        device.risk_score = 0.0
        return True

    def clear_alerts(self) -> None:
        self._active_alerts.clear()

    def add_alert(self, alert: dict) -> None:
        """Insert a manually-created alert (isolate/honeypot/approve) into the
        live in-memory feed so it actually shows up in the dashboard/alerts
        tab instead of only being written to the audit database."""
        key = alert.get("id") or f"manual_{uuid.uuid4().hex[:8]}"
        self._active_alerts[key] = alert
        self._trim_alerts()

    def resolve_alert(self, alert_id: str) -> Optional[dict]:
        """Remove an alert from the live feed (e.g. once an operator has
        approved/actioned it) and return it, or None if not found."""
        key = next(
            (k for k, a in self._active_alerts.items() if a.get("id") == alert_id),
            None,
        )
        if key is None:
            return None
        return self._active_alerts.pop(key)

    def get_all_nodes(self) -> list[dict]:
        return [device.to_dict() for device in self.nodes.values()] + self.honeypots

    def get_active_alerts(self) -> list[dict]:
        return list(self._active_alerts.values())

    def get_gradients(self) -> dict[str, np.ndarray]:
        return {nid: device.gradient for nid, device in self.nodes.items() if device.gradient is not None and not device.is_isolated}

    def set_sanitizing(self, node_id: str) -> None:
        if node_id in self.nodes: self.nodes[node_id].status = "sanitizing"
    def set_health_checking(self, node_id: str) -> None:
        if node_id in self.nodes: self.nodes[node_id].status = "health_check"
    def set_ready_for_reconnect(self, node_id: str) -> None:
        if node_id in self.nodes: self.nodes[node_id].status = "ready_reconnect"
    def reconnect_node(self, node_id: str):
        device = self.nodes.get(node_id)
        if not device or device.status != "ready_reconnect": return None
        device.is_isolated = False
        device.status, device.severity = "normal", "LOW"
        device.anomaly_score = device.risk_score = device.persistence_score = 0.0
        return {"id": device.id, "name": device.name}
    def attack_types(self):
        return self.store.attack_types()
