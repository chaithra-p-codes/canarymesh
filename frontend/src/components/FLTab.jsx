import { C } from './shared'
const BARS=['#3B82F6','#10B981','#8B5CF6','#F59E0B','#0EA5E9','#EC4899']
export default function FLTab({ fl }) {
  if (!fl) return <div style={{textAlign:'center',padding:40,color:C.tm}}>Connecting to FL engine...</div>
  const contribs = Object.values(fl.contributions||{})
  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <span style={{fontSize:13,fontWeight:600,color:C.tp}}>Federated learning engine</span>
          <span style={{fontSize:10,color:C.teal,background:`${C.teal}15`,padding:'2px 8px',borderRadius:4,fontWeight:600}}>Round {fl.round}/{fl.maxRounds}</span>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:14}}>
          <div><div style={{fontSize:10,color:C.tm,marginBottom:2}}>Global accuracy</div>
            <div style={{fontSize:26,fontWeight:700,color:C.accent}}>{fl.accuracy.toFixed(1)}%</div></div>
          <div style={{textAlign:'right'}}><div style={{fontSize:10,color:C.tm,marginBottom:2}}>Raw data shared</div>
            <div style={{fontSize:26,fontWeight:700,color:C.green}}>0 bytes</div></div>
        </div>
        <div style={{height:4,background:C.border,borderRadius:2,marginBottom:4}}>
          <div style={{width:`${(fl.round/fl.maxRounds)*100}%`,height:'100%',background:C.accent,borderRadius:2,transition:'width 0.5s'}}/>
        </div>
        <div style={{fontSize:10,color:C.tm,marginBottom:10,textAlign:'right'}}>{fl.participants} nodes participating</div>
        <div style={{fontSize:11,color:C.tm,marginBottom:8}}>Node gradient contributions (FedAvg on IF offset_ vectors)</div>
        {contribs.map((c,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:8,marginBottom:5}}>
            <span style={{fontSize:10,color:C.tm,width:90,flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}</span>
            <div style={{flex:1,height:4,background:C.border,borderRadius:2}}>
              <div style={{width:c.contributed?`${35+(c.gradient_norm*150)%60}%`:'0%',height:'100%',
                background:c.contributed?BARS[i%BARS.length]:'#334155',borderRadius:2,transition:'width 0.5s'}}/>
            </div>
            <span style={{fontSize:10,color:c.contributed?C.green:C.tm,width:20}}>{c.contributed?'✓':'—'}</span>
          </div>
        ))}
        <div style={{marginTop:12,fontSize:11,color:C.ts,background:`${C.accent}10`,padding:'8px 10px',
          borderRadius:6,borderLeft:`2px solid ${C.accent}`,lineHeight:1.6}}>
          Aggregation: FedAvg on Isolation Forest offset_ parameters + anomaly score vectors.
          Raw sensor data never leaves any node. Privacy preserved by design.
        </div>
      </div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:14}}>
        <div style={{fontSize:13,fontWeight:600,color:C.tp,marginBottom:12}}>How it works</div>
        {[
          {n:'1',t:'Local training',d:'Each node runs Isolation Forest on its own MQTT traffic. Learns what normal looks like for that specific device fingerprint.'},
          {n:'2',t:'Parameter extraction',d:'Node serialises its IF offset_ threshold + anomaly score into a compact parameter vector. No raw data included.'},
          {n:'3',t:'FedAvg aggregation',d:'Server computes traffic-weighted average of all parameter vectors. Nodes with more data get more influence.'},
          {n:'4',t:'Global broadcast',d:'Aggregated parameters sent back. All nodes update their detection thresholds. Network gets smarter every round.'},
          {n:'5',t:'Honeypot bypass',d:'Any honeypot probe skips FL entirely and triggers an immediate HIGH alert with attacker fingerprint logged.'},
        ].map(({n,t,d})=>(
          <div key={n} style={{display:'flex',gap:10,marginBottom:12}}>
            <div style={{width:22,height:22,borderRadius:'50%',background:`${C.accent}20`,border:`1px solid ${C.accent}50`,
              display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:C.accent,flexShrink:0}}>{n}</div>
            <div>
              <div style={{fontSize:12,fontWeight:600,color:C.tp,marginBottom:2}}>{t}</div>
              <div style={{fontSize:11,color:C.ts,lineHeight:1.6}}>{d}</div>
            </div>
          </div>
        ))}
      </div>
      {fl.history?.length>0&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:14}}>
          <div style={{fontSize:13,fontWeight:600,color:C.tp,marginBottom:10}}>Round history</div>
          {fl.history.slice(-5).reverse().map((h,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              padding:'6px 0',borderBottom:i<4?`1px solid ${C.border}`:'none'}}>
              <span style={{fontSize:11,color:C.tm}}>Round {h.round}</span>
              <span style={{fontSize:11,color:C.ts}}>{h.participants} nodes</span>
              <span style={{fontSize:11,color:C.accent,fontWeight:600}}>{h.accuracy}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
