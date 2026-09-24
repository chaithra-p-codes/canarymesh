export const C = {
  bg:'#0A0F1E', panel:'#0F1628', card:'#141B35',
  border:'#1E2D55', borderB:'#2A3F70',
  accent:'#3B82F6', teal:'#0EA5E9',
  green:'#10B981', amber:'#F59E0B',
  red:'#EF4444', purple:'#8B5CF6',
  tp:'#E2E8F0', ts:'#94A3B8', tm:'#475569',
}
export const SEV = {
  LOW:      {label:'Low',      color:C.green,  bg:'#052e16', action:'Alert only'},
  MEDIUM:   {label:'Medium',   color:C.amber,  bg:'#1c1006', action:'Pending approval'},
  HIGH:     {label:'High',     color:C.red,    bg:'#1c0606', action:'Auto-isolating'},
  CRITICAL: {label:'Critical', color:'#FF0000',bg:'#1a0000', action:'Quarantined'},
}
export const NODE_TYPES = ['PLC','Sensor','SCADA','HMI']
export const ICONS = {PLC:'⚙',Sensor:'◈',SCADA:'▣',HMI:'⬡',Honeypot:'⬟'}

// Status → display label + color
export const STATUS_META = {
  normal:           {label:'Normal',          color:C.green},
  suspicious:       {label:'Suspicious',      color:C.amber},
  compromised:      {label:'Compromised',     color:C.red},
  isolated:         {label:'Isolated',        color:C.red},
  sanitizing:       {label:'Sanitizing...',   color:C.amber},
  health_check:     {label:'Health Check',    color:C.teal},
  ready_reconnect:  {label:'Ready ✓',         color:C.green},
  honeypot:         {label:'Honeypot',        color:C.purple},
}

export function Badge({sev}) {
  const s = SEV[sev]||SEV.LOW
  return <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:4,
    background:s.bg,color:s.color,border:`1px solid ${s.color}44`}}>{s.label}</span>
}

export function StatCard({label,value,unit,color,sub}) {
  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px'}}>
      <div style={{fontSize:10,color:C.tm,marginBottom:3}}>{label}</div>
      <div style={{fontSize:22,fontWeight:700,color:color||C.tp}}>
        {value}{unit&&<span style={{fontSize:12,fontWeight:400,color:C.tm,marginLeft:2}}>{unit}</span>}
      </div>
      {sub&&<div style={{fontSize:10,color:C.tm,marginTop:2}}>{sub}</div>}
    </div>
  )
}

// ── Sanitization progress bar ─────────────────────────────────────────────
export function SanitProgress({node}) {
  if (!node.sanitStep) return null
  const steps = ['IP Blocked','Buffer Purged','FL Model Reset','Health Check']
  return (
    <div style={{marginTop:8}}>
      <div style={{fontSize:10,color:C.amber,marginBottom:5,fontWeight:600}}>
        Sanitization in progress — Step {node.sanitStep}/{node.sanitTotal}
      </div>
      <div style={{display:'flex',gap:4}}>
        {steps.map((s,i)=>(
          <div key={i} style={{flex:1}}>
            <div style={{height:3,borderRadius:2,
              background: i<node.sanitStep ? C.green : i===node.sanitStep-1 ? C.amber : C.border,
              transition:'background 0.5s'}}/>
            <div style={{fontSize:8,color:C.tm,marginTop:2,textAlign:'center',lineHeight:1.2}}>{s}</div>
          </div>
        ))}
      </div>
      {node.flRoundRestored && (
        <div style={{fontSize:10,color:C.teal,marginTop:5}}>
          ↺ Overwritten local weights with Global FL Round #{node.flRoundRestored}
        </div>
      )}
    </div>
  )
}

// ── Node detail panel ─────────────────────────────────────────────────────
export function NodeDetail({node,onClose,onIsolate,onRestore,onAttack,onSanitize,onReconnect}) {
  if (!node) return null
  const isH  = node.type==='Honeypot'
  const score = node.anomalyScore||0
  const severity = score>0.75?'CRITICAL':score>0.60?'HIGH':score>0.35?'MEDIUM':'LOW'
  const s     = SEV[severity]
  const sColor= score>0.60?C.red:score>0.35?C.amber:C.green
  const sm    = STATUS_META[node.status]||STATUS_META.normal

  return (
    <div style={{background:C.panel,border:`1px solid ${C.borderB}`,borderRadius:12,padding:14,marginTop:10}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:22}}>{ICONS[node.type]}</span>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:C.tp}}>{node.name}</div>
            <div style={{fontSize:11,color:sm.color,fontWeight:500}}>{sm.label}</div>
          </div>
        </div>
        <button onClick={onClose} style={{background:'none',border:'none',color:C.tm,cursor:'pointer',fontSize:18}}>✕</button>
      </div>

      {isH ? (
        <div style={{background:C.card,borderRadius:8,padding:'10px 12px'}}>
          <div style={{fontSize:12,color:C.ts,lineHeight:1.7}}>Decoy device mimicking a real industrial node. Any probe fingerprints the attacker immediately.</div>
          <div style={{marginTop:8,fontSize:11,color:C.purple}}>Status: Active · Awaiting probe</div>
        </div>
      ) : (
        <>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
            <div style={{background:C.card,borderRadius:8,padding:'8px 10px'}}>
              <div style={{fontSize:10,color:C.tm}}>Anomaly score</div>
              <div style={{fontSize:20,fontWeight:700,color:sColor}}>{(score*100).toFixed(1)}%</div>
              <div style={{height:3,background:C.border,borderRadius:2,marginTop:4}}>
                <div style={{width:`${score*100}%`,height:'100%',background:sColor,borderRadius:2,transition:'width 0.8s ease-in-out'}}/>
              </div>
            </div>
            <div style={{background:C.card,borderRadius:8,padding:'8px 10px'}}>
              <div style={{fontSize:10,color:C.tm}}>Traffic / min</div>
              <div style={{fontSize:20,fontWeight:700,color:C.tp}}>{node.traffic}</div>
              <div style={{fontSize:10,color:C.tm}}>baseline: {node.baseTraffic}</div>
            </div>
          </div>

          {node.mqttSample&&(
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,color:C.tm,marginBottom:5}}>Latest MQTT message</div>
              <div style={{background:'#0A0F1E',borderRadius:8,padding:'8px 10px',fontFamily:'monospace'}}>
                <div style={{fontSize:10,color:C.teal}}>▶ {node.mqttSample.topic}</div>
                <div style={{fontSize:11,color:node.mqttSample.type==='ATTACK'?C.red:C.green,marginTop:3}}>{node.mqttSample.payload}</div>
              </div>
            </div>
          )}

          {node.lastEvidence && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,color:C.tm,marginBottom:5}}>Extracted Telemetry Features (2s window)</div>
              <div style={{background:C.card,borderRadius:8,padding:'8px 10px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                <div>
                  <div style={{fontSize:9,color:C.tm}}>Avg Packet</div>
                  <div style={{fontSize:12,fontWeight:600,color:C.tp}}>{node.lastEvidence.packet_size?.toFixed(1) || 0} B</div>
                </div>
                <div>
                  <div style={{fontSize:9,color:C.tm}}>Reads</div>
                  <div style={{fontSize:12,fontWeight:600,color:C.tp}}>{((node.lastEvidence.query_rate||0)*100).toFixed(0)}%</div>
                </div>
                <div>
                  <div style={{fontSize:9,color:C.tm}}>Destinations</div>
                  <div style={{fontSize:12,fontWeight:600,color:node.lastEvidence.dest_count>3?C.amber:C.tp}}>{node.lastEvidence.dest_count || 0}</div>
                </div>
              </div>
            </div>
          )}

          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:C.tm,marginBottom:5}}>Threat explanation</div>
            <div style={{background:C.card,borderRadius:8,padding:'9px 11px',fontSize:12,color:C.ts,lineHeight:1.6}}>
              {node.threatReason}
              {node.lastEvidence?.honeypot_interaction && (
                <div style={{marginTop:6,color:C.purple,fontWeight:600}}>⚠ Target probed decoy device (Honeypot)!</div>
              )}
            </div>
          </div>

          {/* Sanitization progress */}
          <SanitProgress node={node}/>

          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:C.tm,marginBottom:6}}>Adaptive response tier</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5}}>
              {['LOW','MEDIUM','HIGH','CRITICAL'].map(sev=>{
                const sv=SEV[sev]; const active=sev===severity
                return <div key={sev} style={{padding:'6px 8px',borderRadius:6,
                  background:active?`${sv.color}18`:C.card,border:`1px solid ${active?sv.color:C.border}`,opacity:active?1:0.4}}>
                  <div style={{fontSize:10,fontWeight:600,color:sv.color}}>{sv.label}</div>
                  <div style={{fontSize:9,color:C.tm}}>{sv.action}</div>
                </div>
              })}
            </div>
          </div>

          {/* Action buttons — change based on node state */}
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {/* Normal/suspicious → isolate or attack */}
            {!node.isIsolated && node.status!=='sanitizing' && node.status!=='health_check' && node.status!=='ready_reconnect' && score>=0.35 && (
              <button onClick={()=>onIsolate(node.id)} style={{width:'100%',padding:'9px',borderRadius:8,cursor:'pointer',fontWeight:600,fontSize:12,
                background:score>=0.60?`${C.red}20`:`${C.amber}20`,border:`1px solid ${score>=0.60?C.red:C.amber}`,color:score>=0.60?C.red:C.amber}}>
                {score>=0.60?'Isolate node now':'Request isolation approval'}
              </button>
            )}

            {/* Isolated → offer sanitize */}
            {(node.isIsolated||node.status==='isolated') && node.status!=='sanitizing' && node.status!=='health_check' && node.status!=='ready_reconnect' && (
              <>
                <button onClick={()=>onSanitize(node.id)} style={{width:'100%',padding:'9px',borderRadius:8,cursor:'pointer',fontWeight:600,fontSize:12,
                  background:`${C.teal}20`,border:`1px solid ${C.teal}`,color:C.teal}}>
                  ⚕ Sanitize &amp; run health check
                </button>
                <button onClick={()=>onRestore(node.id)} style={{width:'100%',padding:'7px',borderRadius:8,cursor:'pointer',fontWeight:500,fontSize:11,
                  background:'none',border:`1px solid ${C.border}`,color:C.tm}}>
                  Restore without sanitization
                </button>
              </>
            )}

            {/* Sanitizing/health_check → progress shown above, no button */}
            {(node.status==='sanitizing'||node.status==='health_check') && (
              <div style={{textAlign:'center',fontSize:11,color:C.amber,padding:'8px',
                background:`${C.amber}10`,borderRadius:8,border:`1px solid ${C.amber}30`}}>
                {node.status==='sanitizing'?'Sanitization in progress...':'Running health check observation (10s)...'}
              </div>
            )}

            {/* Ready to reconnect → show reconnect button */}
            {node.status==='ready_reconnect' && (
              <button onClick={()=>onReconnect(node.id)} style={{width:'100%',padding:'9px',borderRadius:8,cursor:'pointer',fontWeight:700,fontSize:12,
                background:`${C.green}20`,border:`1px solid ${C.green}`,color:C.green}}>
                ✓ Approve reconnection — restore to network
              </button>
            )}

            {!node.isIsolated && node.status==='normal' && onAttack && (
              <button onClick={()=>onAttack(node.id,0.85)} style={{width:'100%',padding:'7px',borderRadius:8,cursor:'pointer',fontWeight:500,fontSize:11,
                background:'none',border:`1px solid ${C.border}`,color:C.tm}}>
                Simulate attack on this node
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}