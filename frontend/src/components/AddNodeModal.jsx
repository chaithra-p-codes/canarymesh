// CanaryMesh — Add Node Modal
import { useState } from 'react'
import { C, NODE_TYPES, ICONS } from './shared'

export default function AddNodeModal({ onAdd, onClose }) {
  const [name,    setName]    = useState('')
  const [type,    setType]    = useState('PLC')
  const [traffic, setTraffic] = useState(100)
  const [error,   setError]   = useState('')

  const submit = () => {
    if (!name.trim()) { setError('Node name is required'); return }
    if (name.trim().length < 2) { setError('Name must be at least 2 characters'); return }
    onAdd(name.trim(), type, parseInt(traffic))
    onClose()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }}>
      <div style={{ background:C.panel, border:`1px solid ${C.borderB}`,
        borderRadius:14, padding:20, width:'100%', maxWidth:360 }}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div style={{ fontSize:14, fontWeight:600, color:C.tp }}>Add new node</div>
          <button onClick={onClose}
            style={{ background:'none', border:'none', color:C.tm, cursor:'pointer', fontSize:18 }}>✕</button>
        </div>

        {/* Node type selector */}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:C.tm, marginBottom:6 }}>Device type</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            {NODE_TYPES.map(t => (
              <button key={t} onClick={() => setType(t)} style={{
                padding:'8px', borderRadius:8, cursor:'pointer', fontWeight:500, fontSize:12,
                background: type === t ? `${C.accent}20` : C.card,
                border:`1px solid ${type === t ? C.accent : C.border}`,
                color: type === t ? C.accent : C.ts,
                display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                <span>{ICONS[t]}</span>{t}
              </button>
            ))}
          </div>
        </div>

        {/* Node name */}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:C.tm, marginBottom:6 }}>Node name</div>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            placeholder={`e.g. ${type}-07`}
            style={{ width:'100%', padding:'9px 12px', borderRadius:8, fontSize:13,
              background:C.card, border:`1px solid ${error ? C.red : C.border}`,
              color:C.tp, outline:'none' }}
          />
          {error && <div style={{ fontSize:10, color:C.red, marginTop:4 }}>{error}</div>}
        </div>

        {/* Base traffic */}
        <div style={{ marginBottom:18 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
            <span style={{ fontSize:11, color:C.tm }}>Base traffic (req/min)</span>
            <span style={{ fontSize:11, color:C.accent, fontWeight:600 }}>{traffic}</span>
          </div>
          <input type="range" min={20} max={500} value={traffic}
            onChange={e => setTraffic(e.target.value)}
            style={{ width:'100%', accentColor:C.accent }} />
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ fontSize:10, color:C.tm }}>20 (low)</span>
            <span style={{ fontSize:10, color:C.tm }}>500 (high)</span>
          </div>
        </div>

        {/* Info box */}
        <div style={{ background:`${C.accent}10`, border:`1px solid ${C.accent}30`,
          borderRadius:8, padding:'8px 10px', marginBottom:14, fontSize:11, color:C.ts, lineHeight:1.5 }}>
          The node will join the FL mesh immediately and start local anomaly detection.
          Its MQTT traffic will be simulated at {traffic} req/min baseline.
        </div>

        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:'9px', borderRadius:8, cursor:'pointer',
            background:'none', border:`1px solid ${C.border}`, color:C.tm, fontSize:12 }}>
            Cancel
          </button>
          <button onClick={submit} style={{ flex:2, padding:'9px', borderRadius:8, cursor:'pointer',
            background:C.accent, border:'none', color:'#fff', fontSize:12, fontWeight:600 }}>
            Add {type} node
          </button>
        </div>
      </div>
    </div>
  )
}
