import { useState } from 'react'
import { useWebSocket } from './useWebSocket'
import { C } from './components/shared'
import Dashboard from './components/Dashboard'
import NodesTab  from './components/NodesTab'
import AlertsTab from './components/AlertsTab'
import FLTab     from './components/FLTab'
import MQTTTab   from './components/MQTTTab'
import AuditTab  from './components/AuditTab'

export default function App() {
  const ws = useWebSocket()
  const [tab,     setTab]     = useState('dashboard')
  const [selNode, setSelNode] = useState(null)

  const alertCount    = ws.alerts.filter(a=>a.severity!=='LOW').length
  const criticalCount = ws.alerts.filter(a=>a.severity==='CRITICAL'||a.severity==='HIGH').length

  const TABS = [
    {id:'dashboard',label:'Dashboard'},
    {id:'nodes',    label:'Nodes'},
    {id:'alerts',   label:'Alerts'},
    {id:'fl',       label:'FL Engine'},
    {id:'mqtt',     label:'MQTT Log'},
    {id:'audit',    label:'Audit'},
  ]

  const props = {...ws, selNode, setSelNode, C}

  return (
    <div style={{background:C.bg,minHeight:'100vh',fontFamily:'system-ui,-apple-system,sans-serif',color:C.tp}}>
      <div style={{borderBottom:`1px solid ${C.border}`,padding:'10px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',background:C.panel}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:32,height:32,borderRadius:9,background:`${C.accent}20`,border:`1px solid ${C.accent}50`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:17}}>⬡</div>
          <div>
            <div style={{fontSize:16,fontWeight:700,letterSpacing:'-0.02em'}}>CanaryMesh</div>
            <div style={{fontSize:9,color:C.tm,letterSpacing:'0.07em'}}>INDUSTRIAL IOT SOC</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          {criticalCount>0&&<div style={{background:`${C.red}20`,border:`1px solid ${C.red}50`,borderRadius:6,padding:'3px 10px',fontSize:11,color:C.red,fontWeight:600}}>⚠ {criticalCount} critical</div>}
          <div style={{display:'flex',alignItems:'center',gap:5}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:ws.connected?C.green:C.amber,boxShadow:ws.connected?`0 0 6px ${C.green}`:'none'}}/>
            <span style={{fontSize:11,color:C.ts}}>{ws.connected?'Live':'Reconnecting...'}</span>
          </div>
        </div>
      </div>

      <div style={{display:'flex',borderBottom:`1px solid ${C.border}`,background:C.panel,overflowX:'auto'}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:'10px 14px',fontSize:12,whiteSpace:'nowrap',
            fontWeight:tab===t.id?600:400,color:tab===t.id?C.accent:C.ts,background:'none',border:'none',cursor:'pointer',
            borderBottom:tab===t.id?`2px solid ${C.accent}`:'2px solid transparent',position:'relative'}}>
            {t.label}
            {t.id==='alerts'&&alertCount>0&&<span style={{marginLeft:5,fontSize:10,background:C.red,color:'#fff',borderRadius:10,padding:'1px 5px'}}>{alertCount}</span>}
          </button>
        ))}
      </div>

      <div style={{padding:14}}>
        {tab==='dashboard'&&<Dashboard {...props}/>}
        {tab==='nodes'    &&<NodesTab  {...props}/>}
        {tab==='alerts'   &&<AlertsTab {...props}/>}
        {tab==='fl'       &&<FLTab     {...props}/>}
        {tab==='mqtt'     &&<MQTTTab   {...props}/>}
        {tab==='audit'    &&<AuditTab  {...props}/>}
      </div>
    </div>
  )
}
