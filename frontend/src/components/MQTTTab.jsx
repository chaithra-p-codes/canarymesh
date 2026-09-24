import { C } from './shared'
export default function MQTTTab({ nodes, mqttLog, simulateAttack, triggerHoneypot }) {
  const realNodes = nodes.filter(n=>n.type!=='Honeypot'&&!n.isIsolated)
  return (
    <div>
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:14,marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:600,color:C.tp,marginBottom:10}}>MQTT traffic simulator</div>
        <div style={{fontSize:11,color:C.ts,lineHeight:1.6,marginBottom:12}}>
          Each node publishes to <span style={{color:C.teal,fontFamily:'monospace'}}>factory/&lt;node&gt;/data</span>.
          Normal traffic = regular sensor readings. Attack traffic = unexpected commands, port scans, unknown destinations.
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {realNodes.slice(0,4).map(n=>(
            <button key={n.id} onClick={()=>simulateAttack(n.id,0.9)} style={{
              padding:'6px 12px',borderRadius:7,cursor:'pointer',fontSize:11,fontWeight:500,
              background:`${C.red}15`,border:`1px solid ${C.red}50`,color:C.red}}>
              Attack {n.name}
            </button>
          ))}
          <button onClick={triggerHoneypot} style={{padding:'6px 12px',borderRadius:7,cursor:'pointer',
            fontSize:11,fontWeight:500,background:`${C.purple}15`,border:`1px solid ${C.purple}50`,color:C.purple}}>
            Probe honeypot
          </button>
        </div>
      </div>
      <div style={{background:'#0A0F1E',border:`1px solid ${C.border}`,borderRadius:12,padding:14}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
          <div style={{width:7,height:7,borderRadius:'50%',background:C.green,boxShadow:`0 0 5px ${C.green}`}}/>
          <span style={{fontSize:12,color:C.ts,fontWeight:500}}>Live MQTT message log</span>
        </div>
        {mqttLog.length===0&&<div style={{fontSize:11,color:C.tm,textAlign:'center',padding:'20px 0'}}>Waiting for traffic...</div>}
        {mqttLog.map((m,i)=>(
          <div key={i} style={{marginBottom:8,fontFamily:'monospace'}}>
            <div style={{fontSize:10,color:C.tm}}>{m.time}</div>
            <div style={{fontSize:11,color:C.teal}}>▶ {m.topic}</div>
            <div style={{fontSize:11,color:m.type==='ATTACK'?C.red:m.type==='WARN'?C.amber:C.green}}>{m.payload}</div>
            {i<mqttLog.length-1&&<div style={{borderBottom:`1px solid ${C.border}`,marginTop:6}}/>}
          </div>
        ))}
      </div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:14,marginTop:12}}>
        <div style={{fontSize:12,fontWeight:600,color:C.tp,marginBottom:8}}>Current node traffic</div>
        {nodes.filter(n=>n.type!=='Honeypot').map(n=>(
          <div key={n.id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
            <span style={{fontSize:11,color:C.tm,width:110,flexShrink:0}}>{n.name}</span>
            <div style={{flex:1,height:4,background:C.border,borderRadius:2}}>
              <div style={{width:`${Math.min(100,(n.traffic||0)/5)}%`,height:'100%',
                background:n.status==='suspicious'||n.status==='compromised'?C.red:C.green,
                borderRadius:2,transition:'width 0.5s'}}/>
            </div>
            <span style={{fontSize:10,color:C.tm,width:55,textAlign:'right'}}>{n.traffic||0} r/m</span>
          </div>
        ))}
      </div>
    </div>
  )
}
