import { useState } from 'react'
import { ICONS, NodeDetail, STATUS_META, C } from './shared'
import AddNodeModal from './AddNodeModal'

export default function NodesTab({ nodes, alerts, isolateNode, restoreNode, removeNode, addNode,
  simulateAttack, sanitizeNode, reconnectNode, selNode, setSelNode }) {
  const [showAdd, setShowAdd] = useState(false)
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <span style={{fontSize:12,color:C.tm}}>{nodes.filter(n=>n.type!=='Honeypot').length} nodes · {nodes.filter(n=>n.type==='Honeypot').length} honeypots</span>
        <button onClick={()=>setShowAdd(true)} style={{fontSize:12,padding:'6px 14px',borderRadius:8,cursor:'pointer',background:C.accent,border:'none',color:'#fff',fontWeight:600}}>+ Add node</button>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {nodes.map(n=>{
          const isH=n.type==='Honeypot'; const isSel=selNode?.id===n.id
          const score=n.anomalyScore||0
          const sm=STATUS_META[n.status]||STATUS_META.normal
          const scoreColor=score>0.60?C.red:score>0.35?C.amber:C.green
          let border=C.border
          if(n.status==='compromised'||n.status==='isolated') border=C.red
          else if(n.status==='suspicious') border=C.amber
          else if(n.status==='sanitizing'||n.status==='health_check') border=C.teal
          else if(n.status==='ready_reconnect') border=C.green
          else if(isH) border=C.purple
          else if(isSel) border=C.accent
          const isCustom=n.id?.startsWith('U')
          return (
            <div key={n.id} onClick={()=>setSelNode(isSel?null:n)}
              style={{background:C.card,border:`1px solid ${border}`,borderRadius:10,padding:'10px 12px',cursor:'pointer',transition:'border-color 0.2s'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:isH?0:6}}>
                <div style={{display:'flex',alignItems:'center',gap:7}}>
                  <span style={{fontSize:18,opacity:isH?0.6:1}}>{ICONS[n.type]}</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:500,color:C.tp}}>
                      {n.name}
                      {isCustom&&<span style={{marginLeft:6,fontSize:9,color:C.accent,background:`${C.accent}15`,padding:'1px 5px',borderRadius:3}}>custom</span>}
                    </div>
                    <div style={{fontSize:10,color:C.tm}}>{n.type}</div>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{fontSize:10,padding:'2px 7px',borderRadius:4,fontWeight:600,
                    background:`${sm.color}18`,color:sm.color,border:`1px solid ${sm.color}44`}}>{sm.label}</span>
                  {isCustom&&<button onClick={e=>{e.stopPropagation();removeNode(n.id)}} style={{fontSize:10,padding:'2px 7px',borderRadius:4,cursor:'pointer',background:'none',border:`1px solid ${C.border}`,color:C.tm}}>✕</button>}
                </div>
              </div>
              {!isH&&<div>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <span style={{fontSize:11,color:C.tm}}>Anomaly score</span>
                  <span style={{fontSize:11,color:scoreColor,fontWeight:600}}>{(score*100).toFixed(1)}%</span>
                </div>
                <div style={{height:3,background:C.border,borderRadius:2}}>
                  <div style={{width:`${score*100}%`,height:'100%',background:scoreColor,borderRadius:2,transition:'width 0.8s ease-in-out'}}/>
                </div>
                {/* Sanitization step mini-indicator */}
                {n.sanitStep&&<div style={{marginTop:6,display:'flex',gap:3}}>
                  {[1,2,3,4].map(s=><div key={s} style={{flex:1,height:2,borderRadius:1,
                    background:s<=n.sanitStep?C.amber:C.border}}/>)}
                  <span style={{fontSize:9,color:C.amber,marginLeft:4}}>Step {n.sanitStep}/4</span>
                </div>}
              </div>}
              {isH&&<div style={{fontSize:11,color:C.tm}}>Trap device — monitors unauthorized access</div>}
            </div>
          )
        })}
      </div>
      {selNode&&<NodeDetail node={selNode} onClose={()=>setSelNode(null)}
        onIsolate={isolateNode} onRestore={restoreNode}
        onSanitize={sanitizeNode} onReconnect={reconnectNode}
        onAttack={simulateAttack}/>}
      {showAdd&&<AddNodeModal onAdd={(n,t,tr)=>{addNode(n,t,tr);setShowAdd(false)}} onClose={()=>setShowAdd(false)}/>}
    </div>
  )
}
