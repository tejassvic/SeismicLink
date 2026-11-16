import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from 'react-leaflet'
import { io } from 'socket.io-client'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import CapSimulation from './pages/CapSimulation.jsx'

const API = import.meta.env.VITE_API_URL || ''
const SOCKET = import.meta.env.VITE_SOCKET_URL || API || window.location.origin
const icon = (status) => L.divIcon({className:'node-div-icon',html:`<span class="node-dot ${status}"></span>`,iconSize:[22,22],iconAnchor:[11,11]})
const infraIcon = L.divIcon({className:'infra-div-icon',html:'<span>✚</span>',iconSize:[24,24],iconAnchor:[12,12]})
const fmt = (v) => v ? new Date(v).toLocaleString() : '—'

function FitBounds({nodes, epicenter}) {
  const map = useMap()
  useEffect(() => {
    const pts = nodes.filter(n=>n.latitude!=null&&n.longitude!=null).map(n=>[n.latitude,n.longitude])
    if (epicenter) pts.push([epicenter.latitude,epicenter.longitude])
    if (pts.length>1) map.fitBounds(pts,{padding:[40,40],maxZoom:12})
    else if (pts.length===1) map.setView(pts[0],11)
  },[nodes,epicenter,map])
  return null
}

function Waveform({samples=[]}) {
  const [cursor,setCursor]=useState(0),[playing,setPlaying]=useState(false)
  const stride=Math.max(1,Math.floor(samples.length/500))
  const picked=samples.filter((_,i)=>i%stride===0)
  const values=picked.map(s=>Number(s.x_g||0))
  const max=Math.max(0.001,...values.map(Math.abs))
  const points=values.map((v,i)=>`${(i/(Math.max(1,values.length-1)))*600},${50-(v/max)*42}`).join(' ')
  const cursorX=samples.length>1?(cursor/(samples.length-1))*600:0
  useEffect(()=>{if(!playing)return;const timer=setInterval(()=>setCursor(i=>{if(i>=samples.length-1){setPlaying(false);return samples.length-1}return Math.min(samples.length-1,i+Math.max(1,stride))}),60);return()=>clearInterval(timer)},[playing,samples.length,stride])
  useEffect(()=>{setCursor(0);setPlaying(false)},[samples.length])
  const current=samples[Math.min(cursor,Math.max(0,samples.length-1))]
  return <div className="wave-wrap"><div className="wave-head"><span>Recorded waveform · X axis</span><span>{samples.length.toLocaleString()} samples</span></div><svg viewBox="0 0 600 100" preserveAspectRatio="none"><line x1="0" y1="50" x2="600" y2="50" stroke="#334155" strokeDasharray="4 5"/><polyline points={points} fill="none" stroke="#45d6b0" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/><line x1={cursorX} y1="5" x2={cursorX} y2="95" stroke="#f2ad62" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/></svg><div className="wave-controls"><button onClick={()=>{if(cursor>=samples.length-1)setCursor(0);setPlaying(v=>!v)}} disabled={!samples.length}>{playing?'Ⅱ':'▶'}</button><input type="range" min="0" max={Math.max(0,samples.length-1)} value={Math.min(cursor,Math.max(0,samples.length-1))} onChange={e=>{setPlaying(false);setCursor(Number(e.target.value))}} disabled={!samples.length}/><span>{current?`#${current.sample_index??cursor} · X ${current.x_g??'—'}g`:'No samples'}</span></div></div>
}

function AdminModal({token,setToken,onClose,onRefresh}) {
  const [username,setUsername]=useState('admin'),[password,setPassword]=useState(''),[loginError,setLoginError]=useState('')
  const [form,setForm]=useState({module_id:'',name:'',latitude:'',longitude:'',location_description:'',source:'physical'})
  const [result,setResult]=useState('')
  const auth = token ? {Authorization:`Bearer ${token}`} : {}
  async function login(e){e.preventDefault();setLoginError('');try{const r=await fetch(`${API}/api/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const d=await r.json();if(!r.ok)throw new Error(d.detail||'Login failed');localStorage.setItem('seismo_admin_token',d.access_token);setToken(d.access_token)}catch(err){setLoginError(err.message)}}
  async function saveNode(e){e.preventDefault();setResult('');try{const r=await fetch(`${API}/api/v1/nodes`,{method:'POST',headers:{'Content-Type':'application/json',...auth},body:JSON.stringify({...form,module_id:Number(form.module_id),latitude:form.latitude===''?null:Number(form.latitude),longitude:form.longitude===''?null:Number(form.longitude)})});const d=await r.json();if(!r.ok)throw new Error(d.detail||'Could not save node');setResult(`Node ${d.module_id} saved. Authentication key: ${d.auth_key}`);setForm({module_id:'',name:'',latitude:'',longitude:'',location_description:'',source:'physical'});onRefresh()}catch(err){setResult(err.message)}}
  function logout(){localStorage.removeItem('seismo_admin_token');setToken('');setResult('')}
  return <div className="modal-backdrop" onClick={onClose}><div className="admin-modal" onClick={e=>e.stopPropagation()}><div className="modal-top"><div><div className="eyebrow">CONTROL ROOM</div><h2>Administrator</h2></div><button className="icon-btn" onClick={onClose}>✕</button></div>
    {!token ? <form onSubmit={login} className="form-stack"><p className="muted">Sign in to register nodes and update their coordinates.</p><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>{loginError&&<p className="error-text">{loginError}</p>}<button className="primary-btn">Sign in</button><p className="hint">Demo credentials are configured in the root .env file.</p></form> : <><div className="admin-signed">Signed in as administrator <button className="text-btn" onClick={logout}>Sign out</button></div><form onSubmit={saveNode} className="form-stack"><h3>Register / update node</h3><div className="form-grid"><label>Module ID<input type="number" value={form.module_id} onChange={e=>setForm({...form,module_id:e.target.value})} required/></label><label>Node name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/></label><label>Latitude<input type="number" step="any" value={form.latitude} onChange={e=>setForm({...form,latitude:e.target.value})}/></label><label>Longitude<input type="number" step="any" value={form.longitude} onChange={e=>setForm({...form,longitude:e.target.value})}/></label></div><label>Location description<input value={form.location_description} onChange={e=>setForm({...form,location_description:e.target.value})}/></label><label>Node type<select value={form.source} onChange={e=>setForm({...form,source:e.target.value})}><option value="physical">Physical ESP32 node</option><option value="simulated">Simulated node</option></select></label><button className="primary-btn">Save node</button>{result&&<div className="result-box">{result}</div>}</form></>}
  </div></div>
}

export default function App(){
  const [activeTab,setActiveTab]=useState('overview')
  const [nodes,setNodes]=useState([]),[events,setEvents]=useState([]),[logs,setLogs]=useState([]),[selected,setSelected]=useState(null),[selectedNode,setSelectedNode]=useState(null),[detail,setDetail]=useState(null),[infrastructure,setInfrastructure]=useState([]),[epicenter,setEpicenter]=useState(null),[socketState,setSocketState]=useState('connecting'),[adminOpen,setAdminOpen]=useState(false),[token,setToken]=useState(()=>localStorage.getItem('seismo_admin_token')||''),[infraLoading,setInfraLoading]=useState(false)
  const center=[30.3165,78.0322]
  async function refresh(){try{const [n,e,l]=await Promise.all([fetch(`${API}/api/v1/nodes`).then(r=>r.json()),fetch(`${API}/api/v1/events?limit=60`).then(r=>r.json()),fetch(`${API}/api/v1/system-logs?limit=30`).then(r=>r.json())]);setNodes(n.nodes||[]);setEvents(e.events||[]);setLogs(l.logs||[])}catch(e){console.error(e)}}
  useEffect(()=>{refresh();const t=setInterval(refresh,12000);return()=>clearInterval(t)},[])
  useEffect(()=>{const s=io(SOCKET,{path:'/socket.io',transports:['websocket','polling'],reconnection:true});s.on('connect',()=>setSocketState('live'));s.on('disconnect',()=>setSocketState('reconnecting'));s.on('connect_error',()=>setSocketState('reconnecting'));s.on('nodes_snapshot',d=>setNodes(d.nodes||[]));s.on('node_status',d=>{setSelectedNode(prev=>prev&&prev.module_id===d.module_id?{...prev,status:d.status}:prev);refresh()});s.on('event_started',d=>{refresh();setSelected(d.event_id)});s.on('event_completed',refresh);s.on('node_telemetry',d=>{setNodes(prev=>prev.map(n=>n.module_id===d.module_id?{...n,last_reading:d.reading}:n));setSelectedNode(prev=>prev&&prev.module_id===d.module_id?{...prev,last_reading:d.reading}:prev)});s.on('event_sample',d=>setDetail(prev=>prev&&String(prev.id)===String(d.event_id)?{...prev,waveform:[...(prev.waveform||[]),d.sample],received_samples:d.received_samples}:prev));s.on('epicenter_updated',d=>{setEpicenter(d);refresh()});return()=>s.disconnect()},[])
  // Load the selected event when selection changes. Do not depend on the
  // periodically refreshed event list: doing so cleared the panel every 12s.
  useEffect(()=>{
    if(!selected){setDetail(null);setInfrastructure([]);setEpicenter(null);return}
    let live=true
    const loadSelectedDetail=async()=>{
      try{
        const r=await fetch(`${API}/api/v1/events/${selected}`)
        if(!r.ok)return
        const incoming=await r.json()
        if(!live)return
        setDetail(previous=>{
          if(!previous||String(previous.id)!==String(selected))return incoming
          const oldWave=previous.waveform||[]
          const newWave=incoming.waveform||[]
          // Never replace a fuller live waveform with a shorter/stale API copy.
          const waveform=newWave.length>=oldWave.length?newWave:oldWave
          return {...previous,...incoming,waveform}
        })
      }catch(error){console.error('Could not refresh selected event:',error)}
    }
    loadSelectedDetail()
    // Refresh this event quietly while it is selected; preserve the panel and
    // waveform instead of resetting to a loading state.
    const timer=setInterval(loadSelectedDetail,5000)
    return()=>{live=false;clearInterval(timer)}
  },[selected])
  useEffect(()=>{if(!selected||!detail)return;let live=true;setInfraLoading(true);fetch(`${API}/api/v1/events/${selected}/infrastructure`).then(r=>r.ok?r.json():null).then(d=>{if(live)setInfrastructure(d?.infrastructure||[])}).catch(()=>{if(live)setInfrastructure([])}).finally(()=>{if(live)setInfraLoading(false)});return()=>{live=false}},[selected,detail?.id])
  const active=nodes.filter(n=>n.status==='event').length,online=nodes.filter(n=>n.status==='online').length
  const selectedEvent=events.find(e=>String(e.id)===String(selected))
  const selectedAnalysis=detail?.analysis||selectedEvent?.analysis||{}
  const eventEpicenter=selectedAnalysis.epicenter_latitude!=null?{latitude:selectedAnalysis.epicenter_latitude,longitude:selectedAnalysis.epicenter_longitude,uncertainty_km:selectedAnalysis.uncertainty_km}:null
  const selectedRealtimeEpicenter=epicenter?.event_ids?.includes(selected)?epicenter:null
  const shownEpicenter=eventEpicenter||selectedRealtimeEpicenter
  async function deleteSelectedEvent(){if(!selected||!token||!window.confirm('Permanently delete this event and its waveform?'))return;const r=await fetch(`${API}/api/v1/events/${selected}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});if(r.ok){setSelected(null);refresh()}else{const d=await r.json();alert(d.detail||'Could not delete event')}}
  const nodeColor=(s)=>s==='event'?'event':s==='online'?'online':'offline'
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">S</div><div><strong>SEISMOLINK</strong><span>LIVE SEISMIC MONITORING</span></div></div><div className="top-status"><span className={`status-light ${socketState==='live'?'ok':'warn'}`}/>{socketState==='live'?'LIVE CONNECTION':'RECONNECTING'}<span className="top-divider"/> <span className="muted">API · PostgreSQL</span></div><nav className="main-nav"><button className={activeTab==='overview'?'active':''} onClick={()=>setActiveTab('overview')}>Overview</button><button className={activeTab==='cap'?'active':''} onClick={()=>setActiveTab('cap')}>CAP Simulation</button></nav><button className="admin-btn" onClick={()=>setAdminOpen(true)}>⚙ Admin</button></header>
    {activeTab==='cap' ? <CapSimulation /> : <main className="workspace"><section className="map-column"><div className="page-heading"><div><div className="eyebrow">NETWORK OVERVIEW</div><h1>Seismic monitoring map</h1><p>Live node telemetry, event detections and event-specific impact analysis.</p></div><div className="map-legend"><span><i className="legend-dot online"/>Online</span><span><i className="legend-dot event"/>Event</span><span><i className="legend-dot offline"/>Offline</span></div></div>
      <div className="stats-row"><div className="stat-card"><span>REGISTERED NODES</span><strong>{nodes.length}</strong><small>Physical + simulated</small></div><div className="stat-card"><span>ONLINE</span><strong className="green-text">{online}</strong><small>Heartbeat within threshold</small></div><div className="stat-card"><span>ACTIVE EVENTS</span><strong className="red-text">{active}</strong><small>Live waveform capture</small></div><div className="stat-card"><span>RECORDED EVENTS</span><strong>{events.length}</strong><small>Stored on server</small></div></div>
      <div className="map-card"><div className="map-toolbar"><div><strong>NODE NETWORK</strong><span>OpenStreetMap · Leaflet</span></div><button className="subtle-btn" onClick={refresh}>↻ Refresh</button></div><MapContainer center={center} zoom={11} scrollWheelZoom className="main-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><FitBounds nodes={nodes} epicenter={selected?shownEpicenter:null}/>{nodes.filter(n=>n.latitude!=null&&n.longitude!=null).map(n=><Marker key={n.module_id} position={[n.latitude,n.longitude]} icon={icon(nodeColor(n.status))} eventHandlers={{click:()=>setSelectedNode(n)}}><Popup><b>{n.name}</b><br/>ID: {n.module_id}<br/>Status: {n.status}<br/>Source: {n.source}</Popup></Marker>)}
        {selected&&shownEpicenter&&<>{selectedAnalysis.affected_radius_km&&<Circle center={[shownEpicenter.latitude,shownEpicenter.longitude]} radius={selectedAnalysis.affected_radius_km*1000} pathOptions={{color:'#55b7d5',fillColor:'#55b7d5',fillOpacity:.10}}/>}<Circle center={[shownEpicenter.latitude,shownEpicenter.longitude]} radius={(shownEpicenter.uncertainty_km||10)*1000} pathOptions={{color:'#ef8d4b',fillColor:'#ef8d4b',fillOpacity:.12,dashArray:'7 7'}}/><Marker position={[shownEpicenter.latitude,shownEpicenter.longitude]} icon={L.divIcon({className:'epicenter-icon',html:'<span>✹</span>',iconSize:[30,30],iconAnchor:[15,15]})}><Popup>Estimated epicenter<br/>Uncertainty: ±{shownEpicenter.uncertainty_km||'—'} km</Popup></Marker></>}
        {selected&&infrastructure.map((it,i)=><Marker key={it.osm_id||i} position={[it.latitude,it.longitude]} icon={infraIcon}><Popup><b>{it.name}</b><br/>{it.category}</Popup></Marker>)}
      </MapContainer><div className="map-footer"><span>● {nodes.length} nodes plotted</span><span>{selected?`Event selected · ${infrastructure.length} infrastructure points`:'Select an event to load its affected-region analysis'}</span></div></div>
      <div className="lower-grid"><section className="panel"><div className="panel-title"><div><div className="eyebrow">NETWORK</div><h2>Sensor nodes</h2></div><span className="count-pill">{nodes.length}</span></div><div className="node-list">{nodes.map(n=><div className="node-row" key={n.module_id}><span className={`node-status ${nodeColor(n.status)}`}/><div className="node-info"><b>{n.name}</b><small>ID {n.module_id} · {n.source}</small></div><span className={`state-label ${nodeColor(n.status)}`}>{n.status}</span></div>)}</div></section>
      <section className="panel"><div className="panel-title"><div><div className="eyebrow">RECENT ACTIVITY</div><h2>System log</h2></div><span className="count-pill">{logs.length}</span></div><div className="log-list">{logs.slice(0,7).map(l=><div className="log-row" key={l.id}><span className="log-mark"/><div><b>{l.event_type}</b><small>{l.description}</small></div><time>{fmt(l.created_at)}</time></div>)}</div></section></div>
    </section><aside className="side-column"><section className="panel events-panel"><div className="panel-title"><div><div className="eyebrow">DETECTION ARCHIVE</div><h2>Recent events</h2></div><span className="count-pill">{events.length}</span></div>{events.length===0?<div className="empty-state"><div className="empty-icon">⌁</div><b>No seismic events yet</b><p>Physical detections and simulator events will appear here.</p></div>:<div className="event-list">{events.map(e=><button key={e.id} className={`event-card ${selected===String(e.id)?'selected':''}`} onClick={()=>setSelected(String(e.id))}><div className="event-card-top"><span className="event-tag">{e.source==='simulated'?'SIMULATED':'HARDWARE'}</span><time>{fmt(e.detected_at)}</time></div><strong>{e.node_name||`Node ${e.module_id}`}</strong><div className="event-card-meta"><span>ID {e.node_event_id}</span><span>{e.received_samples||0} samples</span><span className={e.status==='complete'?'green-text':'red-text'}>{e.status}</span></div></button>)}</div>}</section>
      {selectedNode&&<section className="panel node-detail-panel"><div className="panel-title"><div><div className="eyebrow">SELECTED STATION</div><h2>{selectedNode.name}</h2></div><button className="text-btn" onClick={()=>setSelectedNode(null)}>Clear</button></div><div className="analysis-meta"><div><span>Module ID</span><b>{selectedNode.module_id}</b></div><div><span>Connection</span><b className={selectedNode.status==='online'?'green-text':selectedNode.status==='event'?'red-text':''}>{selectedNode.status}</b></div><div><span>Coordinates</span><b>{selectedNode.latitude==null?'Not set':`${Number(selectedNode.latitude).toFixed(5)}, ${Number(selectedNode.longitude).toFixed(5)}`}</b></div><div><span>Last heartbeat</span><b>{fmt(selectedNode.last_seen)}</b></div></div><div className="analysis-summary"><div><span>LIVE X</span><b>{selectedNode.last_reading?.x_g??'—'} <small>g</small></b></div><div><span>LIVE Y / Z</span><b>{selectedNode.last_reading?.y_g??'—'} / {selectedNode.last_reading?.z_g??'—'}</b></div></div></section>}
      {selected&&<section className="panel analysis-panel"><div className="panel-title"><div><div className="eyebrow">SELECTED DETECTION</div><h2>Event analysis</h2></div><div className="panel-actions"><button className="text-btn" onClick={()=>setSelected(null)}>Clear</button>{token&&<button className="text-btn danger" onClick={deleteSelectedEvent}>Delete</button>}</div></div>{!detail?<p className="muted">Loading event…</p>:<><div className="analysis-summary"><div><span>VECTOR RMS</span><b>{selectedAnalysis.vector_rms_g??'—'} <small>g</small></b></div><div><span>PEAK VECTOR</span><b>{selectedAnalysis.peak_vector_g??'—'} <small>g</small></b></div></div><div className="analysis-meta"><div><span>Node</span><b>{detail.node_name} · {detail.module_id}</b></div><div><span>Samples received</span><b>{detail.received_samples}/{detail.expected_samples||'—'}</b></div><div><span>Capture status</span><b>{detail.status}</b></div><div><span>Location solution</span><b>{selectedAnalysis.location_quality||'Awaiting associated nodes'}</b></div></div><Waveform samples={detail.waveform||[]}/><div className="analysis-note">{selectedAnalysis.disclaimer||'Waveform metrics are preliminary. Validated P/S classification is not yet enabled.'}</div><div className="infra-title"><b>Potentially exposed infrastructure</b><span>{infraLoading?'Loading…':`${infrastructure.length} found`}</span></div><p className="hint">Shown only for the selected event. Proximity is not a damage assessment.</p>{infrastructure.slice(0,8).map((it,i)=><div className="infra-row" key={it.osm_id||i}><span>✚</span><div><b>{it.name}</b><small>{it.category}</small></div></div>)}</>}</section>}
    </aside></main>}
    <footer className="footer"><span>SEISMOLINK · EDUCATIONAL SEISMIC MONITORING PLATFORM</span><span>Signal metrics are experimental; not an earthquake warning service.</span></footer>
    {adminOpen&&<AdminModal token={token} setToken={setToken} onClose={()=>setAdminOpen(false)} onRefresh={refresh}/>}
  </div>
}
