import { C } from './shared'
export default function MQTTTab({ nodes, mqttLog, simulateAttack, triggerHoneypot }) {
  const realNodes = nodes.filter(n=>n.type!=='Honeypot'&&!n.isIsolated)
  return (
    <div>
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:14,marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:600,color:C.tp,marginBottom:10}}>MQTT traffic simulator</div>
        <div style={{fontSize:11,color:C.ts,lineHeight:1.6,marginBottom:12}}>
          Each node publishes to <span style={{color:C.teal,fontFamily:'monospace'}}>factory/&lt;node&gt;/[data|cmd|status]</span>.
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

      {/* Live MQTT log */}
      <div style={{background:'#0A0F1E',border:`1px solid ${C.border}`,borderRadius:12,padding:14,marginBottom:12}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
          <div style={{width:7,height:7,borderRadius:'50%',background:C.green,boxShadow:`0 0 5px ${C.green}`}}/>
          <span style={{fontSize:12,color:C.ts,fontWeight:500}}>Live MQTT message log</span>
        </div>
        {mqttLog.length===0&&<div style={{fontSize:11,color:C.tm,textAlign:'center',padding:'20px 0'}}>Waiting for traffic...</div>}
        {mqttLog.map((m,i)=>(
          <div key={i} style={{marginBottom:8,fontFamily:'monospace'}}>
            <div style={{fontSize:10,color:C.tm}}>{m.time}</div>
            <div style={{fontSize:11,color:C.teal}}>▶ {m.topic}</div>
            <div style={{fontSize:11,color:m.type==='ATTACK'?C.red:m.type==='WARN'?C.amber:m.type==='SYSTEM'?C.teal:C.green}}>{m.payload}</div>
            {m.destination&&<div style={{fontSize:10,color:C.tm,marginTop:2}}>→ {m.destination}{m.command&&` [${m.command}]`}</div>}
            {i<mqttLog.length-1&&<div style={{borderBottom:`1px solid ${C.border}`,marginTop:6}}/>}
          </div>
        ))}
      </div>

      {/* Per-node last message sample from real broker */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:14,marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:600,color:C.tp,marginBottom:8}}>Latest broker message per node</div>
        {nodes.filter(n=>n.type!=='Honeypot').map(n=>{
          const s = n.mqttSample
          if (!s) return null
          return (
            <div key={n.id} style={{display:'flex',alignItems:'flex-start',gap:8,marginBottom:8,
              padding:'6px 8px',borderRadius:6,background:s.type==='ATTACK'?`${C.red}08`:C.panel}}>
              <span style={{fontSize:10,color:C.tm,width:110,flexShrink:0,paddingTop:2}}>{n.name}</span>
              <div style={{fontFamily:'monospace',flex:1}}>
                <div style={{fontSize:10,color:C.teal}}>{s.topic}</div>
                <div style={{fontSize:11,color:s.type==='ATTACK'?C.red:C.green,marginTop:1}}>{s.payload}</div>
              </div>
              <span style={{fontSize:9,padding:'2px 5px',borderRadius:3,fontWeight:600,flexShrink:0,
                background:s.type==='ATTACK'?`${C.red}20`:`${C.green}20`,
                color:s.type==='ATTACK'?C.red:C.green}}>{s.type}</span>
            </div>
          )
        })}
      </div>

      {/* Traffic volume bars */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:14}}>
        <div style={{fontSize:12,fontWeight:600,color:C.tp,marginBottom:8}}>Current node traffic vs baseline</div>
        {nodes.filter(n=>n.type!=='Honeypot').map(n=>{
          const pct = Math.min(100, ((n.traffic||0) / (n.baseTraffic||1)) * 50)
          const isHigh = (n.traffic||0) > (n.baseTraffic||1) * 1.5
          return (
            <div key={n.id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
              <span style={{fontSize:11,color:C.tm,width:110,flexShrink:0}}>{n.name}</span>
              <div style={{flex:1,height:4,background:C.border,borderRadius:2}}>
                <div style={{width:`${pct}%`,height:'100%',
                  background:isHigh?C.red:n.status==='suspicious'?C.amber:C.green,
                  borderRadius:2,transition:'width 0.5s'}}/>
              </div>
              <span style={{fontSize:10,color:isHigh?C.red:C.tm,width:65,textAlign:'right'}}>
                {n.traffic||0}/{n.baseTraffic||0} r/m
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}