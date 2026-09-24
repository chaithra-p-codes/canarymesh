import { useState, useEffect } from 'react'
import { C } from './shared'
const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
export default function AuditTab() {
  const [decisions, setDecisions] = useState([])
  const [alerts,    setAlerts]    = useState([])
  const [view,      setView]      = useState('decisions')
  useEffect(()=>{
    fetch(`${API}/api/audit`).then(r=>r.json()).then(d=>setDecisions(d.decisions||[])).catch(()=>{})
    fetch(`${API}/api/alerts`).then(r=>r.json()).then(d=>setAlerts(d.alerts||[])).catch(()=>{})
  },[])
  return (
    <div>
      <div style={{display:'flex',gap:8,marginBottom:12}}>
        {['decisions','alerts'].map(v=>(
          <button key={v} onClick={()=>setView(v)} style={{flex:1,padding:'8px',borderRadius:8,cursor:'pointer',fontSize:12,
            background:view===v?`${C.accent}20`:C.card,border:`1px solid ${view===v?C.accent:C.border}`,
            color:view===v?C.accent:C.ts,fontWeight:view===v?600:400,textTransform:'capitalize'}}>
            {v} ({v==='decisions'?decisions.length:alerts.length})
          </button>
        ))}
      </div>
      {view==='decisions'&&(
        decisions.length===0?<div style={{textAlign:'center',padding:40,color:C.tm}}>No operator decisions logged yet.</div>:
        decisions.map((d,i)=>(
          <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px',marginBottom:8}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:12,fontWeight:600,color:C.tp}}>{d.node_id} — {d.action}</span>
              <span style={{fontSize:10,color:C.tm,fontFamily:'monospace'}}>{d.timestamp?.slice(11,19)||''}</span>
            </div>
            <div style={{fontSize:11,color:C.ts}}>Operator: {d.operator} · {d.reason}</div>
          </div>
        ))
      )}
      {view==='alerts'&&(
        alerts.length===0?<div style={{textAlign:'center',padding:40,color:C.tm}}>No alerts in database yet.</div>:
        alerts.map((a,i)=>(
          <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px',marginBottom:8}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:12,fontWeight:600,color:C.tp}}>{a.node_name} — {a.severity}</span>
              <span style={{fontSize:10,color:C.tm,fontFamily:'monospace'}}>{a.timestamp}</span>
            </div>
            <div style={{fontSize:11,color:C.ts,lineHeight:1.5}}>{a.reason}</div>
          </div>
        ))
      )}
    </div>
  )
}
