import { useState, useEffect } from 'react'
import { StatCard, NodeDetail, Badge, SEV, C as CC } from './shared'

const EDGES=[['N1','N2'],['N2','N3'],['N1','N4'],['N4','N5'],['N5','N6'],['N3','N6'],['N2','N5']]
const SCENARIO_STEPS=[
  {label:'Reconnaissance',   desc:'Attacker scanning MQTT ports...',               color:CC.amber,  duration:2000},
  {label:'Honeypot Probe',   desc:'Decoy PLC-99 contacted from 192.168.99.1',      color:CC.purple, duration:2000},
  {label:'Lateral Movement', desc:'Cross-node compromise detected on SCADA-03',    color:CC.red,    duration:2000},
  {label:'Auto-Isolation',   desc:'Node quarantined. Initiating sanitization...',  color:'#FF0000', duration:2000},
]

function getColor(n,alerts){
  if(n.type==='Honeypot') return CC.purple
  if(n.status==='isolated'||n.status==='compromised') return CC.red
  if(n.status==='sanitizing'||n.status==='health_check') return CC.teal
  if(n.status==='ready_reconnect') return CC.green
  if(n.status==='suspicious') return CC.amber
  const a=alerts.find(x=>x.nodeId===n.id)
  if(a?.severity==='HIGH'||a?.severity==='CRITICAL') return CC.red
  if(a?.severity==='MEDIUM') return CC.amber
  return CC.green
}

export default function Dashboard({nodes,alerts,fl,sanitLog,selNode,setSelNode,
  isolateNode,restoreNode,simulateAttack,triggerHoneypot,sanitizeNode,reconnectNode}) {
  const [scenarioStep,   setScenarioStep]   = useState(-1)
  const [scenarioRunning,setScenarioRunning]= useState(false)
  const [weightsKb,      setWeightsKb]      = useState(2.4)

  useEffect(()=>{
    const id=setInterval(()=>setWeightsKb(w=>parseFloat((w+0.1).toFixed(1))),3000)
    return()=>clearInterval(id)
  },[])

  const realNodes   = nodes.filter(n=>n.type!=='Honeypot')
  const healthy     = realNodes.filter(n=>n.status==='normal').length
  const suspicious  = realNodes.filter(n=>n.status==='suspicious').length
  const dashAlerts  = alerts.filter(a=>a.severity!=='LOW').slice(0,4)

  const runScenario = async()=>{
    if(scenarioRunning) return
    setScenarioRunning(true)
    const attackable=nodes.filter(n=>n.type!=='Honeypot'&&!n.isIsolated)
    const target=attackable[Math.floor(Math.random()*attackable.length)]
    if(!target){setScenarioRunning(false);return}
    for(let i=0;i<SCENARIO_STEPS.length;i++){
      setScenarioStep(i)
      await new Promise(r=>setTimeout(r,SCENARIO_STEPS[i].duration))
      if(i===0) simulateAttack(target.id,0.4)
      if(i===1) await triggerHoneypot()
      if(i===2) simulateAttack(target.id,0.92)
      if(i===3){ isolateNode(target.id); setTimeout(()=>sanitizeNode(target.id),1500) }
    }
    await new Promise(r=>setTimeout(r,1500))
    setScenarioStep(-1); setScenarioRunning(false)
  }

  return(
    <div>
      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}}>
        <StatCard label="Healthy nodes"  value={healthy}  unit={`/${realNodes.length}`} color={CC.green}/>
        <StatCard label="Active alerts"  value={alerts.filter(a=>a.severity!=='LOW').length} color={alerts.filter(a=>a.severity!=='LOW').length>0?CC.red:CC.green} sub="Medium+ only"/>
        <StatCard label="Suspicious"     value={suspicious} color={CC.amber} sub="Under watch"/>
        <StatCard label="FL accuracy"    value={fl?fl.accuracy.toFixed(1):'--'} unit="%" color={CC.accent} sub={fl?`Round ${fl.round}/${fl.maxRounds}`:'Loading'}/>
      </div>

      {/* Privacy verification */}
      <div style={{background:CC.card,border:`1px solid ${CC.borderB}`,borderRadius:12,padding:'10px 14px',marginBottom:14,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{textAlign:'center',flex:1}}>
          <div style={{fontSize:10,color:CC.tm,marginBottom:3}}>Raw data exchanged</div>
          <div style={{fontSize:20,fontWeight:700,color:CC.green}}>0 KB</div>
          <div style={{fontSize:9,color:CC.green}}>✓ Privacy preserved</div>
        </div>
        <div style={{width:1,height:40,background:CC.border}}/>
        <div style={{textAlign:'center',flex:1}}>
          <div style={{fontSize:10,color:CC.tm,marginBottom:3}}>Model gradients exchanged</div>
          <div style={{fontSize:20,fontWeight:700,color:CC.accent}}>{weightsKb} KB</div>
          <div style={{fontSize:9,color:CC.accent}}>FL only</div>
        </div>
        <div style={{width:1,height:40,background:CC.border}}/>
        <div style={{textAlign:'center',flex:1}}>
          <div style={{fontSize:10,color:CC.tm,marginBottom:3}}>FL rounds done</div>
          <div style={{fontSize:20,fontWeight:700,color:CC.purple}}>{fl?fl.round*10:'--'}</div>
          <div style={{fontSize:9,color:CC.purple}}>Aggregations</div>
        </div>
      </div>

      {/* Topology */}
      <div style={{background:CC.panel,borderRadius:12,border:`1px solid ${CC.border}`,overflow:'hidden',marginBottom:14}}>
        <div style={{padding:'10px 14px',borderBottom:`1px solid ${CC.border}`,display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:CC.green,boxShadow:`0 0 6px ${CC.green}`}}/>
          <span style={{fontSize:12,color:CC.ts,fontWeight:500}}>Live network topology</span>
          <span style={{marginLeft:'auto',fontSize:11,color:CC.tm}}>{realNodes.length} nodes · 2 honeypots</span>
        </div>
        <svg viewBox="0 0 100 100" style={{width:'100%',height:250}} preserveAspectRatio="xMidYMid meet">
          {EDGES.map(([a,b])=>{
            const na=nodes.find(n=>n.id===a),nb=nodes.find(n=>n.id===b)
            if(!na?.position||!nb?.position) return null
            return <line key={`${a}-${b}`} x1={na.position.x} y1={na.position.y} x2={nb.position.x} y2={nb.position.y}
              stroke={CC.borderB} strokeWidth="0.5" strokeDasharray="2,1.5" opacity="0.7"/>
          })}
          {nodes.map(n=>{
            if(!n.position) return null
            const color=getColor(n,alerts); const isSel=selNode?.id===n.id; const isH=n.type==='Honeypot'
            return(
              <g key={n.id} onClick={()=>setSelNode(isSel?null:n)} style={{cursor:'pointer'}}>
                {isSel&&<circle cx={n.position.x} cy={n.position.y} r={6} fill="none" stroke={color} strokeWidth="0.8" opacity="0.5"/>}
                <circle cx={n.position.x} cy={n.position.y} r={isH?2.8:3.5}
                  fill={`${color}25`} stroke={color} strokeWidth={isH?0.6:0.9}
                  strokeDasharray={isH?"1.5,1":undefined}/>
                <text x={n.position.x} y={n.position.y+7} textAnchor="middle" fontSize="2.4" fill={CC.ts} fontFamily="monospace">{n.name}</text>
              </g>
            )
          })}
        </svg>
        <div style={{padding:'6px 14px 10px',display:'flex',gap:14,flexWrap:'wrap'}}>
          {[{color:CC.green,l:'Normal'},{color:CC.amber,l:'Suspicious'},{color:CC.red,l:'Compromised'},
            {color:CC.teal,l:'Sanitizing'},{color:CC.purple,l:'Honeypot'}].map(({color,l})=>(
            <div key={l} style={{display:'flex',alignItems:'center',gap:5}}>
              <div style={{width:7,height:7,borderRadius:'50%',background:color}}/>
              <span style={{fontSize:10,color:CC.tm}}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {selNode&&<NodeDetail node={selNode} onClose={()=>setSelNode(null)}
        onIsolate={isolateNode} onRestore={restoreNode}
        onSanitize={sanitizeNode} onReconnect={reconnectNode} onAttack={simulateAttack}/>}

      {/* Demo controls */}
      <div style={{background:CC.card,border:`1px solid ${CC.border}`,borderRadius:12,padding:14,marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:600,color:CC.ts,marginBottom:10}}>Demo controls</div>
        <button onClick={runScenario} disabled={scenarioRunning} style={{width:'100%',padding:'11px',borderRadius:9,cursor:scenarioRunning?'not-allowed':'pointer',
          marginBottom:10,fontWeight:700,fontSize:13,border:`1px solid ${scenarioRunning?CC.amber:CC.accent}`,
          background:scenarioRunning?`${CC.amber}20`:`linear-gradient(135deg,${CC.accent},#6366F1)`,
          color:scenarioRunning?CC.amber:'#fff'}}>
          {scenarioRunning?'⏳ Scenario running...':'⚡ 1-Click Industrial Cyber Attack Scenario'}
        </button>
        {scenarioRunning&&scenarioStep>=0&&(
          <div style={{marginBottom:10}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
              {SCENARIO_STEPS.map((step,i)=>{
                const done=i<scenarioStep,active=i===scenarioStep
                return <div key={i} style={{flex:1,textAlign:'center',padding:'0 2px'}}>
                  <div style={{height:3,borderRadius:2,marginBottom:4,transition:'background 0.5s',
                    background:done?CC.green:active?step.color:CC.border}}/>
                  <div style={{fontSize:9,color:done?CC.green:active?step.color:CC.tm,fontWeight:active?600:400,lineHeight:1.3}}>
                    {done?'✓ ':active?'▶ ':''}{step.label}
                  </div>
                </div>
              })}
            </div>
            <div style={{fontSize:11,color:SCENARIO_STEPS[scenarioStep]?.color,
              background:`${SCENARIO_STEPS[scenarioStep]?.color}15`,borderRadius:7,padding:'6px 10px',
              textAlign:'center',border:`1px solid ${SCENARIO_STEPS[scenarioStep]?.color}40`}}>
              {SCENARIO_STEPS[scenarioStep]?.desc}
            </div>
          </div>
        )}
        <div style={{display:'flex',gap:8}}>
          <button onClick={triggerHoneypot} style={{flex:1,padding:'8px',borderRadius:8,cursor:'pointer',
            fontSize:11,fontWeight:500,background:`${CC.purple}15`,border:`1px solid ${CC.purple}50`,color:CC.purple}}>Probe honeypot</button>
          <button onClick={()=>{const a=nodes.filter(n=>n.type!=='Honeypot'&&!n.isIsolated);if(a.length)simulateAttack(a[Math.floor(Math.random()*a.length)].id,0.85)}}
            style={{flex:1,padding:'8px',borderRadius:8,cursor:'pointer',fontSize:11,fontWeight:500,background:`${CC.red}15`,border:`1px solid ${CC.red}50`,color:CC.red}}>Simulate attack</button>
        </div>
      </div>

      {/* Sanitization live log */}
      {sanitLog?.length>0&&(
        <div style={{background:CC.panel,border:`1px solid ${CC.border}`,borderRadius:12,padding:14,marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:600,color:CC.ts,marginBottom:8}}>Sanitization audit log</div>
          {sanitLog.slice(0,5).map((e,i)=>{
            const color={start:CC.amber,block_ip:CC.amber,purge_queue:CC.amber,fl_model_reset:CC.teal,
              health_check:CC.teal,passed:CC.green,failed:CC.red,reconnected:CC.green}[e.type]||CC.ts
            return <div key={i} style={{display:'flex',gap:8,padding:'5px 0',borderBottom:`1px solid ${CC.border}`}}>
              <span style={{fontSize:10,color:CC.tm,fontFamily:'monospace',flexShrink:0}}>{e.time}</span>
              <span style={{fontSize:11,color,lineHeight:1.5}}>{e.message}</span>
            </div>
          })}
        </div>
      )}

      {/* Recent alerts */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <span style={{fontSize:12,color:CC.ts,fontWeight:500}}>Recent alerts</span>
        <span style={{fontSize:10,color:CC.tm}}>Medium+ only · LOW hidden</span>
      </div>
      {dashAlerts.length===0?<div style={{textAlign:'center',padding:'20px',color:CC.tm,fontSize:12}}>✓ No medium/high/critical alerts</div>
       :dashAlerts.map(alert=>{
        const s=SEV[alert.severity]||SEV.LOW
        return <div key={alert.id} style={{background:CC.card,border:`1px solid ${CC.border}`,borderLeft:`3px solid ${s.color}`,borderRadius:10,padding:'10px 12px',marginBottom:8}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
            <div style={{display:'flex',alignItems:'center',gap:7}}><Badge sev={alert.severity}/><span style={{fontSize:12,fontWeight:600,color:CC.tp}}>{alert.node}</span></div>
            <span style={{fontSize:10,color:CC.tm,fontFamily:'monospace'}}>{alert.time}</span>
          </div>
          <p style={{fontSize:11,color:CC.ts,margin:'0 0 6px',lineHeight:1.5}}>{alert.reason}</p>
          <span style={{fontSize:10,color:s.color,fontWeight:500}}>● {s.action}</span>
        </div>
      })}
    </div>
  )
}
