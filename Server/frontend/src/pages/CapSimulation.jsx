import { useEffect, useMemo, useState } from 'react'

const API = import.meta.env.VITE_API_URL || ''
const fmt = value => value ? new Date(value).toLocaleString() : '—'

export default function CapSimulation() {
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useState('')
  const [area, setArea] = useState('')
  const [severity, setSeverity] = useState('Unknown')
  const [urgency, setUrgency] = useState('Unknown')
  const [certainty, setCertainty] = useState('Observed')
  const [headline, setHeadline] = useState('Seismic event detected')
  const [instruction, setInstruction] = useState('Follow instructions from local authorities. This is an experimental monitoring system, not an official warning.')
  const [error, setError] = useState('')
  useEffect(() => { fetch(`${API}/api/v1/events?limit=100`).then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load events'))).then(d => { setEvents(d.events || []); if (d.events?.length) setEventId(String(d.events[0].id)) }).catch(e => setError(e.message)) }, [])
  const selected = events.find(e => String(e.id) === eventId)
  const cap = useMemo(() => {
    if (!selected) return ''
    const now = new Date().toISOString()
    const sent = selected.detected_at ? new Date(selected.detected_at).toISOString() : now
    const identifier = `urn:uuid:${selected.id}`
    const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    return `<?xml version="1.0" encoding="UTF-8"?>\n<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">\n  <identifier>${identifier}</identifier>\n  <sender>SeismoLink-Demo</sender>\n  <sent>${now}</sent>\n  <status>Test</status>\n  <msgType>Alert</msgType>\n  <scope>Private</scope>\n  <info>\n    <category>Geo</category>\n    <event>${esc(headline)}</event>\n    <urgency>${urgency}</urgency>\n    <severity>${severity}</severity>\n    <certainty>${certainty}</certainty>\n    <effective>${sent}</effective>\n    <headline>${esc(headline)}</headline>\n    <description>${esc(area || `Node ${selected.module_id} event recorded at ${fmt(selected.detected_at)}. Status: ${selected.status}.`)}</description>\n    <instruction>${esc(instruction)}</instruction>\n  </info>\n</alert>`
  }, [selected, area, severity, urgency, certainty, headline, instruction])
  return <main className="cap-page">
    <div className="page-heading"><div><div className="eyebrow">COMMON ALERTING PROTOCOL</div><h1>CAP message simulator</h1><p>Preview a CAP 1.2 test message from a recorded SeismoLink event.</p></div></div>
    <div className="cap-layout">
      <section className="panel cap-form">
        <div className="panel-title"><div><div className="eyebrow">MESSAGE CONFIGURATION</div><h2>Alert details</h2></div></div>
        {error && <p className="error-text">{error}</p>}
        <label>Source event<select value={eventId} onChange={e=>setEventId(e.target.value)}><option value="">Select recorded event</option>{events.map(e=><option key={e.id} value={e.id}>Node {e.module_id} · {fmt(e.detected_at)} · {e.status}</option>)}</select></label>
        {selected && <div className="cap-event-meta"><span>Event ID <b>{selected.node_event_id}</b></span><span>Samples <b>{selected.received_samples}/{selected.expected_samples || '—'}</b></span><span>Status <b>{selected.status}</b></span></div>}
        <label>Headline<input value={headline} onChange={e=>setHeadline(e.target.value)} /></label>
        <label>Affected area / description<textarea rows="3" value={area} onChange={e=>setArea(e.target.value)} placeholder="Describe the area and observed conditions" /></label>
        <div className="form-grid">
          <label>Severity<select value={severity} onChange={e=>setSeverity(e.target.value)}>{['Extreme','Severe','Moderate','Minor','Unknown'].map(v=><option key={v}>{v}</option>)}</select></label>
          <label>Urgency<select value={urgency} onChange={e=>setUrgency(e.target.value)}>{['Immediate','Expected','Future','Past','Unknown'].map(v=><option key={v}>{v}</option>)}</select></label>
          <label>Certainty<select value={certainty} onChange={e=>setCertainty(e.target.value)}>{['Observed','Likely','Possible','Unlikely','Unknown'].map(v=><option key={v}>{v}</option>)}</select></label>
        </div>
        <label>Public instruction<textarea rows="3" value={instruction} onChange={e=>setInstruction(e.target.value)} /></label>
        <p className="hint">This page generates a local XML preview only. It does not dispatch alerts or contact emergency services.</p>
      </section>
      <section className="panel cap-preview"><div className="panel-title"><div><div className="eyebrow">CAP 1.2 OUTPUT</div><h2>XML preview</h2></div><button className="subtle-btn" disabled={!cap} onClick={()=>navigator.clipboard?.writeText(cap)}>Copy XML</button></div><pre>{cap || 'Select a recorded event to generate a CAP preview.'}</pre></section>
    </div>
  </main>
}
