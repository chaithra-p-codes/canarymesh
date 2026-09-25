import { useEffect, useMemo, useState } from 'react'
import { C } from './shared'

const PHASES = [
  {
    key: 'detection_isolation',
    n: 1,
    title: 'Detection & Isolation',
    desc: 'An anomaly or honeypot probe is evaluated for severity. High/critical risk instantly revokes MQTT routing and moves the node to Quarantined.',
  },
  {
    key: 'sanitization_eradication',
    n: 2,
    title: 'Automated Sanitization & Eradication',
    desc: 'The attack source is blocked at the broker, the volatile command queue is purged, and the corrupted local model is discarded for the clean federated one.',
  },
  {
    key: 'health_check_verification',
    n: 3,
    title: 'Health Check & Verification Handshake',
    desc: 'A 10-second observation window confirms packet rates and payload variables are back within normal bounds before the node goes anywhere near production traffic.',
  },
  {
    key: 'reconnection_reintegration',
    n: 4,
    title: 'Reconnection & Re-integration',
    desc: 'An operator reviews the evidence and approves reconnection. The node returns to Normal and live MQTT streaming resumes.',
  },
]

const STATUS_STYLE = {
  idle: { label: 'Idle', color: C.tm, glow: false },
  in_progress: { label: 'In progress', color: C.amber, glow: true },
  complete: { label: 'Complete', color: C.green, glow: false },
  failed: { label: 'Not triggered', color: C.ts, glow: false },
  awaiting_operator: { label: 'Awaiting you', color: C.accent, glow: true },
}

const CONNECTION_META = {
  connected: { label: 'Connected — live MQTT streaming', color: C.green, wire: 'solid' },
  attacking: { label: 'Attack in progress — evaluating risk', color: C.red, wire: 'flash' },
  disconnected: { label: 'Disconnected — quarantined', color: C.red, wire: 'broken' },
  sanitizing: { label: 'Sanitizing — eradicating attack footprint', color: C.amber, wire: 'broken-dash' },
  verifying: { label: 'Verifying — health check in progress', color: C.teal, wire: 'broken-dash' },
  ready: { label: 'Verified clean — awaiting your approval to reconnect', color: C.accent, wire: 'broken-dash' },
  unknown: { label: 'No device selected', color: C.tm, wire: 'solid' },
}

function buildCurrentRun(log) {
  if (!log.length) return null
  const deviceId = log[0].deviceId
  const entries = []
  for (const entry of log) {
    if (entry.deviceId !== deviceId) continue
    entries.push(entry)
    if (entry.phase === 'detection_isolation' && entry.status === 'in_progress') break
  }
  entries.reverse()
  return { deviceId, entries }
}

function logPhaseStatus(run, key) {
  if (!run) return 'idle'
  const matches = run.entries.filter((e) => e.phase === key)
  if (!matches.length) return 'idle'
  return matches[matches.length - 1].status
}

function logPhaseMessage(run, key) {
  if (!run) return null
  const matches = run.entries.filter((e) => e.phase === key)
  return matches.length ? matches[matches.length - 1].message : null
}

// Phase status is derived from the narrated log where available, but always
// corrected against the device's actual live state -- this is what makes
// "Approve reconnection" (and the diagram) reflect reality even when the
// narration log hasn't caught up, or when the device got here through the
// manual Isolate/Sanitize buttons on the Devices tab instead of the demo.
function derivePhases(run, device) {
  const phases = {
    detection_isolation: logPhaseStatus(run, 'detection_isolation'),
    sanitization_eradication: logPhaseStatus(run, 'sanitization_eradication'),
    health_check_verification: logPhaseStatus(run, 'health_check_verification'),
    reconnection_reintegration: logPhaseStatus(run, 'reconnection_reintegration'),
  }
  if (!device) return phases

  if (device.isIsolated && phases.detection_isolation === 'idle') phases.detection_isolation = 'complete'
  if (device.status === 'sanitizing') phases.sanitization_eradication = 'in_progress'
  if (device.status === 'health_check') {
    if (phases.sanitization_eradication !== 'failed') phases.sanitization_eradication = 'complete'
    phases.health_check_verification = 'in_progress'
  }
  if (device.status === 'ready_reconnect') {
    phases.sanitization_eradication = 'complete'
    phases.health_check_verification = 'complete'
    phases.reconnection_reintegration = 'awaiting_operator'
  }
  if (!device.isIsolated && device.status === 'normal' && phases.reconnection_reintegration !== 'idle') {
    phases.reconnection_reintegration = 'complete'
  }
  return phases
}

function connectionState(device, phases) {
  if (!device) return 'unknown'
  if (phases.detection_isolation === 'in_progress') return 'attacking'
  if (device.status === 'sanitizing') return 'sanitizing'
  if (device.status === 'health_check') return 'verifying'
  if (device.status === 'ready_reconnect') return 'ready'
  if (device.isIsolated) return 'disconnected'
  return 'connected'
}

function ConnectionDiagram({ device, state }) {
  const meta = CONNECTION_META[state] || CONNECTION_META.unknown
  const broken = meta.wire === 'broken' || meta.wire === 'broken-dash'
  const dash = meta.wire === 'broken-dash' ? '5,4' : undefined

  return (
    <div style={{ padding: 16, background: C.card, borderRadius: 11, border: `1px solid ${C.border}` }}>
      <svg viewBox="0 0 320 100" style={{ width: '100%', height: 140, display: 'block' }}>
        <rect x="8" y="35" width="76" height="30" rx="7" fill={`${C.accent}1a`} stroke={C.accent} strokeWidth="1.2" />
        <text x="46" y="54" textAnchor="middle" fontSize="9" fill={C.accent} fontFamily="monospace">Gateway</text>

        {!broken && (
          <line
            x1="84" y1="50" x2="236" y2="50" stroke={meta.color} strokeWidth="2.2"
            strokeDasharray={meta.wire === 'flash' ? '7,5' : undefined}
            style={meta.wire === 'flash' ? { animation: 'cm-flash .5s linear infinite' } : undefined}
          />
        )}
        {broken && (
          <>
            <line x1="84" y1="50" x2="142" y2="50" stroke={meta.color} strokeWidth="2.2" strokeDasharray={dash} />
            <line x1="178" y1="50" x2="236" y2="50" stroke={meta.color} strokeWidth="2.2" strokeDasharray={dash} />
            <text x="160" y="45" textAnchor="middle" fontSize="15" fill={meta.color}>{state === 'disconnected' ? '✕' : '⋯'}</text>
          </>
        )}

        {state === 'connected' && [0, 1, 2].map((i) => (
          <circle key={i} r="2.6" fill={C.green}>
            <animateMotion dur="1.5s" repeatCount="indefinite" begin={`${i * 0.5}s`} path="M84,50 L236,50" />
          </circle>
        ))}

        <rect x="236" y="35" width="76" height="30" rx="7" fill={`${meta.color}1a`} stroke={meta.color} strokeWidth="1.2" />
        <text x="274" y="54" textAnchor="middle" fontSize="9" fill={meta.color} fontFamily="monospace">{(device?.name || '—').slice(0, 14)}</text>
      </svg>
      <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: meta.color, marginTop: 2 }}>{meta.label}</div>
    </div>
  )
}

export default function ArchitectureFlow({ devices = [], intrusionLog = [], simulateIntrusion, reconnectDevice }) {
  const realDevices = devices.filter((d) => d.type !== 'Honeypot')
  const run = useMemo(() => buildCurrentRun(intrusionLog), [intrusionLog])

  const [selectedId, setSelectedId] = useState('')
  const [starting, setStarting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [notice, setNotice] = useState(null)

  // Follow whichever device the most recent simulated intrusion targeted,
  // unless the operator has explicitly picked a different one to inspect.
  useEffect(() => {
    if (run?.deviceId) setSelectedId((prev) => prev || run.deviceId)
  }, [run?.deviceId])

  const diagramDevice = realDevices.find((d) => d.id === selectedId) || (run && realDevices.find((d) => d.id === run.deviceId)) || realDevices[0] || null
  const phases = derivePhases(run && run.deviceId === diagramDevice?.id ? run : null, diagramDevice)
  const state = connectionState(diagramDevice, phases)
  const running = phases.detection_isolation === 'in_progress' || phases.sanitization_eradication === 'in_progress' || phases.health_check_verification === 'in_progress'

  const start = async () => {
    setStarting(true)
    setNotice(null)
    const result = await simulateIntrusion(selectedId || undefined)
    setStarting(false)
    if (result?.success && result.deviceId) {
      setSelectedId(result.deviceId)
    } else {
      setNotice({ tone: 'error', text: result?.error || 'Could not start the simulated intrusion.' })
    }
  }

  const approve = async () => {
    if (!diagramDevice) return
    setApproving(true)
    setNotice(null)
    const result = await reconnectDevice(diagramDevice.id)
    setApproving(false)
    if (result) {
      setNotice({ tone: 'success', text: `✅ ${diagramDevice.name} reconnected successfully — back to Normal, live MQTT streaming resumed.` })
    } else {
      setNotice({ tone: 'error', text: `${diagramDevice.name} is not ready to reconnect yet, or the request failed.` })
    }
  }

  return (
    <div>
      <div style={{ padding: 14, background: C.panel, border: `1px solid ${C.borderB}`, borderRadius: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 750 }}>End-to-end incident response</div>
        <div style={{ marginTop: 5, fontSize: 11, color: C.ts, lineHeight: 1.6, maxWidth: 720 }}>
          CanaryMesh's defenses are strong, but that doesn't mean nothing ever gets through the front door — this replays a
          real labelled attack row against a live device and walks it through the exact same four-phase pipeline the
          manual controls use, so you can watch detection, eradication, verification, and reconnection happen end to end.
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ padding: 9, borderRadius: 7, background: C.card, color: C.tp, border: `1px solid ${C.border}`, fontSize: 11 }}>
            {realDevices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button onClick={start} disabled={starting || running || diagramDevice?.isIsolated} style={{ padding: '9px 14px', borderRadius: 7, cursor: starting || running || diagramDevice?.isIsolated ? 'not-allowed' : 'pointer', background: `${C.red}14`, color: C.red, border: `1px solid ${C.red}55`, fontWeight: 700, fontSize: 11, opacity: starting || running || diagramDevice?.isIsolated ? 0.5 : 1 }}>
            {running ? 'Intrusion in progress…' : 'Simulate hacker intrusion'}
          </button>
        </div>
        {notice && (
          <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: notice.tone === 'success' ? `${C.green}15` : `${C.amber}15`, color: notice.tone === 'success' ? C.green : C.amber, border: `1px solid ${notice.tone === 'success' ? C.green : C.amber}44` }}>
            {notice.text}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <ConnectionDiagram device={diagramDevice} state={state} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
        {PHASES.map((phase) => {
          const status = phases[phase.key]
          const style = STATUS_STYLE[status]
          const message = run && run.deviceId === diagramDevice?.id ? logPhaseMessage(run, phase.key) : null
          return (
            <div key={phase.key} style={{ position: 'relative', padding: 12, background: C.card, border: `1px solid ${status === 'idle' ? C.border : `${style.color}55`}`, borderRadius: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ width: 22, height: 22, borderRadius: 99, background: `${style.color}1a`, color: style.color, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800 }}>{phase.n}</div>
                <span style={{ fontSize: 9, fontWeight: 700, color: style.color, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {style.glow && <span style={{ width: 6, height: 6, borderRadius: 99, background: style.color, animation: 'cm-pulse 1.2s ease-in-out infinite' }} />}
                  {style.label}
                </span>
              </div>
              <div style={{ marginTop: 9, fontSize: 12, fontWeight: 700 }}>{phase.title}</div>
              <div style={{ marginTop: 5, fontSize: 10, color: C.tm, lineHeight: 1.5 }}>{phase.desc}</div>
              {message && <div style={{ marginTop: 8, padding: 8, background: `${style.color}0d`, borderRadius: 7, fontSize: 10, color: C.ts, lineHeight: 1.5 }}>{message}</div>}
              {status === 'awaiting_operator' && diagramDevice && (
                <button onClick={approve} disabled={approving} style={{ marginTop: 9, width: '100%', padding: 8, borderRadius: 7, cursor: approving ? 'not-allowed' : 'pointer', background: `${C.green}15`, color: C.green, border: `1px solid ${C.green}55`, fontWeight: 700, fontSize: 10, opacity: approving ? 0.6 : 1 }}>
                  {approving ? 'Reconnecting…' : 'Approve reconnection'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 11, overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 700 }}>Live narrative</div>
        <div style={{ maxHeight: 320, overflowY: 'auto', padding: 10 }}>
          {intrusionLog.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: C.tm, fontSize: 11 }}>No simulated intrusion has been run yet.</div>
          ) : intrusionLog.map((entry, i) => {
            const style = STATUS_STYLE[entry.status] || STATUS_STYLE.idle
            return (
              <div key={i} style={{ display: 'flex', gap: 9, padding: '7px 4px', borderBottom: i < intrusionLog.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <span style={{ width: 8, height: 8, marginTop: 4, borderRadius: 99, background: style.color, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 9, color: C.tm, fontFamily: 'monospace' }}>{entry.timestamp?.slice(11, 19)} · {PHASES.find((p) => p.key === entry.phase)?.title || entry.phase}</div>
                  <div style={{ fontSize: 11, color: C.ts, marginTop: 2, lineHeight: 1.5 }}>{entry.message}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
