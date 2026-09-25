# What was actually broken, and what changed (this pass)

Verified live by running your real backend against your real ToN-IoT CSVs and hitting
the exact endpoints the buttons call — not by re-reading the code.

## Root cause 1: devices were auto-isolating themselves within ~60 seconds, from
## normal (non-attack) data

`node_manager.py`'s risk formula gave a flat +35 points any time
`IsolationForest.predict()` flagged a row as an outlier. With `contamination=0.05`,
the model is *designed* to flag ~5% of even perfectly normal data as an outlier.
Combined with a persistence EMA that ratchets up across consecutive ticks, this
reliably pushed devices into HIGH/CRITICAL and auto-isolated them from pure noise.
Confirmed live: 4 of 6 devices isolated themselves within the first minute of
startup, before any button was ever clicked.

This is why "Replay first available attack" looked dead — by the time you clicked
it, most devices were already isolated and there was nothing left to target.

**Fix:** recalibrated the detection (lower contamination, wider anomaly-reference
margin, dampened persistence, held-out-data calibration instead of in-sample, and
live replay now uses rows the model was never trained/calibrated on). Automatic
isolation now also requires *sustained* anomaly (persistence ≥ gate) rather than
firing on a single noisy tick. Verified with a 1000-tick / 6-device simulation
(~33 min of simulated runtime): **zero false auto-isolations**, vs. constant false
isolations before.

## Root cause 2: "Replay attack" did nothing visible even when it worked

I manually queued a real "backdoor" attack row onto a device via the actual API.
It replayed correctly (`attackType: "backdoor"` showed up) — but anomaly score
stayed at exactly `0.0` and severity stayed `LOW`. Checked why: the bundled
per-device CSVs only contain the sensor's own physical readings (e.g. temperature/
pressure/humidity for Weather) — no network-layer columns. Statistically, attack
rows and normal rows are nearly identical in just those fields, because ToN-IoT's
attacks target the network/broker layer, not the sensor value itself. The
unsupervised model has no way to tell them apart from that data alone.

**Fix:** "Replay attack" is documented (see `INTEGRATION_NOTES.md`) as an
operator-triggered demonstration that "replays an actual labeled attack row" — it
is not part of automatic/background detection, and no attack row ever appears
except via this explicit button. So this action now uses the label as strong,
transparently-flagged evidence (`groundTruthUsedForRisk: true` only for this
path), guaranteeing a clear, immediate reaction: HIGH/CRITICAL severity, a new
alert, and auto-isolation within a single tick of clicking. Verified live for all
four dataset types (modbus, weather, garage_door, thermostat).

## Root cause 3: alert count could grow without bound

`check_alerts()` keyed each alert by `device:severity:timestamp`. Since the
timestamp changes every tick, a device sitting at the same severity for many
ticks in a row generated a **brand new alert every single tick, forever** — this
is what could flood the Alerts tab.

**Fix:** at most one open alert per device now; a new one is only created when a
device newly crosses above LOW or escalates to a higher severity, and it's cleared
automatically when severity returns to LOW. Added a hard cap (300) as a defensive
backstop regardless. Verified stable (alert count fluctuating 3-4, not growing)
over a 2-minute live run.

## Files changed
- `ml_federated/node_manager.py` — recalibration, auto-isolation gate, alert dedup/cap
- `backend/dataset_loader.py` — added `advance_normal_cursor` so live replay uses
  held-out rows, not training rows
- `backend/main.py` — auto-isolation now checks the new gate instead of firing on
  any single HIGH/CRITICAL tick; isolate/approve paths clean up the standing
  alert they're resolving

## This pass's additional changes (all-severities + Approve isolation for MEDIUM)

Verified live again after this pass:

- **Alerts could silently vanish or downgrade before you could click them.**
  The alert queue used to overwrite a device's entry every tick based on its
  *current* severity. So if a device briefly hit MEDIUM/HIGH and then calmed
  back down a tick or two later (which happens naturally and is expected),
  the alert in the queue would flip back down or disappear — often before you
  had a chance to click "Approve isolation". Confirmed live: a device hit
  HIGH, its own live reading dropped back to LOW two seconds later, but the
  *alert* stayed HIGH in the queue (correct, new behavior) — under the old
  logic it would have vanished. This is almost certainly what "kinda not
  working" was: the button was there, then it wasn't, depending on timing.

  **Fix:** an alert now only ever escalates in the queue, never silently
  downgrades or disappears on its own. It stays exactly as raised until an
  operator approves/isolates it or clears it. Verified live: approved a
  MEDIUM alert 6 seconds after the device's live severity had already reset
  to LOW — it still worked correctly.

- **All four severities (LOW/MEDIUM/HIGH/CRITICAL) now show up.** Previously
  `check_alerts()` explicitly skipped LOW, so the Alerts tab could never show
  a LOW example. Every device now registers a LOW entry immediately, then
  escalates from there. Confirmed live: 6 LOW alerts appear within the first
  couple seconds of startup, one per device.

- **"Approve isolation" now also works for HIGH/CRITICAL alerts, not just
  MEDIUM.** Because auto-isolation is (correctly) gated behind sustained
  evidence to avoid false positives, a transient HIGH/CRITICAL blip could sit
  in the queue forever with no way to resolve it (the button only rendered
  for MEDIUM). The button now renders for any alert above LOW, and the
  backend already had no such restriction on the REST endpoint. Verified
  live: approved a stuck HIGH alert on a device whose live severity had
  already reset to LOW; it isolated correctly.

Files touched this pass: `ml_federated/node_manager.py` (`check_alerts`
redesigned, see `SEVERITY_RANK`), `frontend/src/components/AlertsTab.jsx`,
`frontend/src/useWebSocket.js`, `backend/main.py` (WS `approve_isolation`
handler relaxed to match the REST endpoint).


## How to verify yourself
1. Start the backend, open the dashboard, and just watch for 60+ seconds — no
   device should isolate itself on its own from noise.
2. Open the Alerts tab right after startup — you should see one alert per
   device, most/all LOW at first.
3. Click "Replay first available attack" — within ~2 seconds that device's
   card should turn red/CRITICAL, a new alert should appear, and it should
   show as isolated.
4. Click "Controlled honeypot probe" — a new HIGH alert should appear
   immediately for the honeypot.
5. Watch the Alerts tab for a MEDIUM or HIGH alert to appear on its own; it
   should stay put (not disappear or downgrade) until you click "Approve
   isolation" on it, which should isolate that device and log an
   `approve_isolation` decision.
6. Open the Audit tab — you should see `auto_isolate`, `honeypot_probe`, and
   `approve_isolation` entries with real timestamps.

## This pass: 4-phase architecture, hacker intrusion demo, MEDIUM-only approval, dark/light theme

- **Approve isolation reverted to MEDIUM-only**, enforced at the backend now
  (not just hidden in the UI): the REST `/api/alerts/{id}/approve` endpoint
  and the WebSocket `approve_isolation` handler both reject anything that
  isn't MEDIUM with an explicit error. Matches the PDF spec exactly: Medium
  = pending operator approval; High/Critical = isolated automatically by
  policy, no approval needed or possible. Verified live: approving a HIGH
  alert now returns `success: false` with that exact reasoning; approving a
  MEDIUM alert still isolates correctly.

- **New: "Simulate hacker intrusion"** (Architecture tab). One click replays
  a real labelled attack row against a live device and narrates it through
  all four of the PDF's named phases end-to-end: Detection & Isolation →
  Automated Sanitization & Eradication → Health Check & Verification
  Handshake → Reconnection & Re-integration (left as a manual operator click,
  exactly as the PDF specifies). Backed by a new `/api/simulate/intrusion`
  endpoint and `intrusion_narrative` WebSocket events. Verified live end to
  end: `auto_isolate → block_source → purge_queue → fl_model_reset →
  health_check_passed` all landed in the audit log from one call, and the
  device's status genuinely progressed `isolated → sanitizing → health_check
  → ready_reconnect → normal` after approving reconnection.

- **Found and fixed a real pre-existing bug while wiring this up**: device
  status in `/api/state` was computed as `"isolated" if self.is_isolated
  else self.status`, which meant `is_isolated` (true for the entire
  isolate→sanitize→health-check→ready-to-reconnect duration) always
  overrode the more specific status, so a REST poll happening every ~2.5s
  would silently stomp the "Sanitizing…" / "Health check…" state back to
  a flat "Isolated" — this affected the existing manual "Sanitize & health
  check" button too, not just the new demo. Fixed to just use `self.status`
  directly, which was already being set correctly everywhere; verified live
  that both the manual button and the new intrusion demo now show the real
  live phase over REST polling, not just over the WebSocket push.

- **Dark/light theme toggle** (sun/moon button, top right). Implemented via
  a live ES-module binding reassignment rather than threading a theme
  context through every component, to avoid a large, riskier refactor of
  the ~20 places that build colors like `` `${C.red}66` `` (which breaks if
  `C.red` becomes a CSS variable string instead of a literal hex color).
  Verified the reassignment-visibility mechanism works with a standalone
  Node ESM test before relying on it. `SEV`, `STATUS_META`, and `ACTION_META`
  were the one place this pattern doesn't reach on its own (they were plain
  objects evaluated once at import time), so those became functions
  (`getSev()`, `getStatusMeta()`, `getActionMeta()`) computed fresh on each
  render; a few stray hardcoded hex colors were also switched to theme
  tokens. Persisted to `localStorage` (this is a real deployed app, not a
  claude.ai artifact, so plain localStorage is fine here).

Files touched this pass: `backend/main.py` (approval gate, new intrusion
endpoint/orchestrator), `ml_federated/node_manager.py` (`to_dict` status
fix), `frontend/src/components/shared.jsx` (theme system, `getSev`/
`getStatusMeta`), `frontend/src/components/ArchitectureFlow.jsx` (new),
`frontend/src/App.jsx` (theme toggle, new Architecture tab),
`frontend/src/useWebSocket.js` (intrusion log + trigger, MEDIUM-only revert),
`frontend/src/components/AlertsTab.jsx`, `NodesTab.jsx`, `AuditTab.jsx`,
`MQTTTab.jsx`, `Dashboard.jsx` (theme-token fixes), `frontend/index.html`
(pulse animation).

## Note on the uploaded prototype zip

The second zip you uploaded is an earlier, simpler prototype (synthetic
random telemetry, no ToN-IoT data, no dataset loader). Its backend logic is
a subset of what's already in this project — the 4-phase sanitization
pipeline it describes was already implemented here (just not labeled or
demoed clearly), so I built the explicit architecture view and the intrusion
demo on top of the current, already-debugged ToN-IoT backend rather than
merging the older prototype's files in, which would have reintroduced the
synthetic-data approach and lost the detection-accuracy fixes from earlier
in this conversation. The `product/` marketing pages (landing/auth/
onboarding/admin) were not touched in either zip, since the request was
about the detection/response dashboard itself.

## This pass: connection diagram, fixed "Approve reconnection", light toggle on landing page

- **Found the actual "Approve reconnection" bug.** It wasn't the backend --
  reconnect always worked server-side. Two real problems:
  1. The Architecture tab derived each phase's status purely from the
     narrated `intrusion_narrative` log. But reconnecting doesn't emit a
     narrative event (it emits a different message, `node_reconnected`), so
     after a successful reconnect the phase-4 card just stayed frozen on
     "Awaiting you" forever with the button still showing -- the click
     worked, but nothing on screen ever confirmed it.
  2. `reconnectDevice` sent the action over the WebSocket using a
     fire-and-forget helper that resolves `true` the instant the message is
     *sent*, without waiting for the backend's actual response -- so success/
     failure feedback was never reliable in the first place.

  **Fix:** phase status is now derived primarily from the device's actual
  live state (`status`/`isIsolated` from `/api/state`), with the narrated
  log only used to fill in messages -- so the diagram and phase cards always
  match reality regardless of how the device got there (the demo button or
  the manual Devices-tab buttons). `reconnectDevice` now calls the REST
  endpoint directly and reports the real result. Verified with an isolated
  logic test covering "just reconnected but log still says awaiting" and
  confirmed it now correctly resolves to "complete" instead of getting
  stuck, then verified live against the real backend.

- **Reconnection confirmation message.** Clicking "Approve reconnection" now
  shows a clear banner: "✅ {device} reconnected successfully — back to
  Normal, live MQTT streaming resumed," or a specific error if it wasn't
  actually ready.

- **New connection diagram** (Gateway ↔ Device) on the Architecture tab,
  per selected device: a solid green wire with animated flowing dots when
  connected; a flashing red wire while an attack is being evaluated; a
  broken red wire with a "✕" while quarantined; a broken amber/teal dashed
  wire while sanitizing/verifying; and it snaps back to a solid animated
  green wire the moment reconnection is approved. A device dropdown lets
  you inspect any device's live connection state, not just the one most
  recently attacked.

- **Dark/light toggle added to `product/landing/index.html`.** That page
  already used CSS custom properties, so this was a straightforward
  `[data-theme="light"]` override block plus a small toggle button and
  inline script (theme read from `localStorage` in `<head>` before first
  paint, to avoid a flash of the wrong theme).

Files touched: `frontend/src/components/ArchitectureFlow.jsx` (rewritten),
`frontend/src/useWebSocket.js` (`reconnectDevice`/`reconnectNode` now use
REST directly), `frontend/index.html` (`cm-flash` keyframes),
`product/landing/index.html` (theme toggle).

## This pass: topology color mismatch + legend

- **Found the actual bug**: the Live Device Topology map's dot colors and
  the per-device risk-bar colors were both pulling from the *sticky* alerts
  queue (intentionally "sticky" since the Approve-isolation fix a few
  passes back -- an alert stays visible until an operator resolves it, even
  after the device's own live reading recovers). That's correct for the
  Alerts tab, but it leaked into the topology map: a device that spiked
  once and recovered kept showing a red dot on the map long after its own
  "Low" badge said otherwise, because the map was checking "is there an old
  alert for this device" instead of "what is this device's current state."
  Fixed: `nodeColor`/`riskColor` now derive purely from the device's own
  live `severity`/`status` fields -- the same fields the badge already
  uses -- so the map and the badges can no longer disagree.
- Also tightened the "Healthy devices" count to be computed from the exact
  same fields (`!isIsolated && severity === 'LOW'`) instead of a separate
  `status === 'normal'` check, removing any chance of the two drifting.
  Note: a device mid-sanitize can legitimately show a "Low" risk badge
  (its score is reset to 0 as part of cleanup) while still correctly not
  counting as "healthy," since it's still isolated pending the health
  check -- that's expected behavior, not a bug.
- **Added a color legend** under the topology map: Normal (green),
  Medium/suspicious (amber), High/critical (red), Sanitizing/verifying
  (teal), Honeypot (dashed purple).

Files touched: `frontend/src/components/Dashboard.jsx`.
