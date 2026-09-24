import { useState, useEffect } from 'react'
import { C } from './shared'
const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const ACTION_META = {
  isolate:             { label:'Isolate',        color: C.red    },
  auto_isolate:        { label:'Auto-Isolate',   color:'#FF0000' },
  sanitize:            { label:'Sanitize',       color: C.teal   },
  block_ip:            { label:'Block IP',       color: C.amber  },
  purge_queue:         { label:'Purge Queue',    color: C.amber  },
  fl_model_reset:      { label:'FL Reset',       color: C.teal   },
  health_check_passed: { label:'Health ✓',       color: C.green  },
  reconnect:           { label:'Reconnect',      color: C.green  },
}

export default function AuditTab() {
  const [decisions, setDecisions] = useState([])
  const [alerts,    setAlerts]    = useState([])
  const [view,      setView]      = useState('decisions')

  const refresh = () => {
    fetch(`${API}/api/audit`).then(r=>r.json()).then(d=>setDecisions(d.decisions||[])).catch(()=>{})
    fetch(`${API}/api/alerts`).then(r=>r.json()).then(d=>setAlerts(d.alerts||[])).catch(()=>{})
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 10000)
    return () => clearInterval(id)
  }, [])

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{display:'flex',gap:8}}>
          {['decisions','alerts'].map(v=>(
            <button key={v} onClick={()=>setView(v)} style={{padding:'8px 14px',borderRadius:8,cursor:'pointer',fontSize:12,
              background:view===v?`${C.accent}20`:C.card,border:`1px solid ${view===v?C.accent:C.border}`,
              color:view===v?C.accent:C.ts,fontWeight:view===v?600:400,textTransform:'capitalize'}}>
              {v} ({v==='decisions'?decisions.length:alerts.length})
            </button>
          ))}
        </div>
        <button onClick={refresh} style={{fontSize:11,padding:'5px 10px',borderRadius:6,cursor:'pointer',
          background:'none',border:`1px solid ${C.border}`,color:C.tm}}>↻ Refresh</button>
      </div>

      {view==='decisions'&&(
        decisions.length===0
          ? <div style={{textAlign:'center',padding:40,color:C.tm}}>No operator decisions logged yet.</div>
          : decisions.map((d,i)=>{
              const am = ACTION_META[d.action] || { label: d.action, color: C.ts }
              const isAuto = d.operator === 'system'
              return (
                <div key={i} style={{background:C.card,border:`1px solid ${isAuto?am.color+'55':C.border}`,
                  borderLeft:`3px solid ${am.color}`,borderRadius:10,padding:'10px 12px',marginBottom:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
                    <div style={{display:'flex',alignItems:'center',gap:7}}>
                      <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:4,
                        background:`${am.color}18`,color:am.color,border:`1px solid ${am.color}44`}}>
                        {am.label}
                      </span>
                      <span style={{fontSize:12,fontWeight:600,color:C.tp}}>{d.node_id}</span>
                      {isAuto&&<span style={{fontSize:9,color:C.tm,background:`${C.tm}15`,
                        padding:'1px 5px',borderRadius:3}}>auto</span>}
                    </div>
                    <span style={{fontSize:10,color:C.tm,fontFamily:'monospace'}}>{d.timestamp?.slice(11,19)||''}</span>
                  </div>
                  <div style={{fontSize:11,color:C.ts,lineHeight:1.5}}>
                    <span style={{color:C.tm}}>Operator: </span>{d.operator} · {d.reason}
                  </div>
                </div>
              )
            })
      )}

      {view==='alerts'&&(
        alerts.length===0
          ? <div style={{textAlign:'center',padding:40,color:C.tm}}>No alerts in database yet.</div>
          : alerts.map((a,i)=>{
              const sevColor = a.severity==='CRITICAL'?'#FF0000':a.severity==='HIGH'?C.red:a.severity==='MEDIUM'?C.amber:C.green
              return (
                <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,
                  borderLeft:`3px solid ${sevColor}`,borderRadius:10,padding:'10px 12px',marginBottom:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                    <div style={{display:'flex',alignItems:'center',gap:7}}>
                      <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:4,
                        background:`${sevColor}18`,color:sevColor,border:`1px solid ${sevColor}44`}}>
                        {a.severity}
                      </span>
                      <span style={{fontSize:12,fontWeight:600,color:C.tp}}>{a.node_name}</span>
                    </div>
                    <span style={{fontSize:10,color:C.tm,fontFamily:'monospace'}}>{a.timestamp}</span>
                  </div>
                  <div style={{fontSize:11,color:C.ts,lineHeight:1.5}}>{a.reason}</div>
                </div>
              )
            })
      )}
    </div>
  )
}