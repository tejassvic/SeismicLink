import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../config'
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import MarkerClusterGroup from 'react-leaflet-cluster'
import L from 'leaflet'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

const INFRA_ICONS = {
  hospital: '🏥', clinic: '💊', school: '🏫', university: '🎓',
  police: '👮', fire_station: '🚒', shelter: '🏠', bridge: '🌉',
  road: '🛣️', default: '📍',
}
const CATEGORY_LABELS = {
  hospital: 'Hospital', clinic: 'Clinic', education: 'Education',
  emergency: 'Emergency services', shelter: 'Shelter',
  bridge: 'Bridge', road: 'Major road', infrastructure: 'Infrastructure',
}
const CATEGORY_COLORS = {
  hospital: '#dc2626', clinic: '#dc2626', education: '#2563eb',
  emergency: '#ea580c', shelter: '#16a34a', bridge: '#7c3aed',
  road: '#64748b', infrastructure: '#64748b',
}

function getInfrastructureIcon(infra) {
  const color = CATEGORY_COLORS[infra.category] || '#64748b'
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="width:24px;height:24px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 7px #0006;display:flex;align-items:center;justify-content:center;font-size:13px">${INFRA_ICONS[infra.amenity_type] || INFRA_ICONS.default}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

function getEventIcon(selected = false) {
  const size = selected ? 32 : 25
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="width:${size}px;height:${size}px;background:#dc2626;border:3px solid white;border-radius:50%;box-shadow:0 0 12px #ef444499;display:flex;align-items:center;justify-content:center;color:white;font-weight:800">E</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function MapController({ event }) {
  const map = useMap()
  const lastTargetRef = useRef(null)

  useEffect(() => {
    if (event?.mapLatitude == null || event?.mapLongitude == null) return

    // Only move the map when the selected event actually changes.
    // Event objects are refreshed/recreated during polling; depending on the
    // whole object here would repeatedly reset the user's manual zoom.
    const targetKey = `${event.event_id}:${event.mapLatitude}:${event.mapLongitude}`
    if (lastTargetRef.current === targetKey) return

    lastTargetRef.current = targetKey
    map.flyTo([Number(event.mapLatitude), Number(event.mapLongitude)], 11, {
      duration: 0.8,
      animate: true,
    })
  }, [event?.event_id, event?.mapLatitude, event?.mapLongitude, map])

  return null
}

function getEventCoordinates(event) {
  const analysis = event.analysis || {}
  const latitude = analysis.epicenter_latitude ?? event.node_latitude
  const longitude = analysis.epicenter_longitude ?? event.node_longitude
  return { latitude, longitude }
}

function formatDate(value) {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function ImpactMap({ darkMode = false }) {
  const { eventId } = useParams()
  const navigate = useNavigate()
  const [events, setEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [infrastructure, setInfrastructure] = useState([])
  const [loadingEvents, setLoadingEvents] = useState(true)
  const [loadingInfrastructure, setLoadingInfrastructure] = useState(false)
  const [eventsError, setEventsError] = useState('')
  const [infrastructureError, setInfrastructureError] = useState('')
  const [radiusKm, setRadiusKm] = useState('')
  const [centerSource, setCenterSource] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true)
    setEventsError('')
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/events?limit=100`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || `Could not load events (${response.status})`)
      const mapped = (payload.events || []).map(event => {
        const coords = getEventCoordinates(event)
        return {
          ...event,
          event_id: event.id,
          event_name: event.node_name ? `Event — ${event.node_name}` : `Seismic event ${String(event.id).slice(0, 8)}`,
          magnitude: event.analysis?.magnitude_estimate ?? event.analysis?.magnitude ?? null,
          mapLatitude: coords.latitude,
          mapLongitude: coords.longitude,
        }
      })
      setEvents(mapped)
      setSelectedEvent(current => {
        const wantedId = eventId || current?.event_id
        return mapped.find(item => item.event_id === wantedId) || mapped[0] || null
      })
    } catch (error) {
      setEventsError(error.message || 'Network error while loading seismic events')
    } finally {
      setLoadingEvents(false)
    }
  }, [eventId])

  useEffect(() => { loadEvents() }, [loadEvents])

  const loadInfrastructure = useCallback(async (event) => {
    if (!event) {
      setInfrastructure([])
      setInfrastructureError('')
      setCenterSource('')
      return
    }
    const analysis = event.analysis || {}
    // The API can search around an estimated epicenter, or around the
    // registered station when only one station is available. It labels the
    // latter as station proximity, never as an earthquake impact zone.
    const estimatedRadius = Number(analysis.affected_radius_km)
    const radius = Number.isFinite(estimatedRadius) && estimatedRadius > 0 ? estimatedRadius : 5

    setLoadingInfrastructure(true)
    setInfrastructureError('')
    setInfrastructure([])
    setRadiusKm(radius)
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/events/${encodeURIComponent(event.event_id)}/infrastructure?radius_km=${encodeURIComponent(Math.min(radius, 50))}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || `OpenStreetMap lookup failed (${response.status})`)
      setInfrastructure(payload.infrastructure || [])
      setRadiusKm(payload.radius_km ?? radius)
      if (!payload.infrastructure?.length && payload.status !== 'pending') {
        setInfrastructureError('No mapped facilities were returned. OpenStreetMap may be temporarily busy or have limited coverage here. Retry in a moment.')
      }
      setCenterSource(payload.center_source || '')
      if (payload.status === 'pending') {
        setInfrastructureError(payload.reason || 'Location information is pending for this event.')
      } else if (payload.status === 'station_proximity') {
        setInfrastructureError('No epicenter is available yet. Showing facilities near the registered sensor station only; this is not an earthquake impact zone.')
      }
    } catch (error) {
      setCenterSource('')
      setInfrastructureError(`${error.message || 'Unable to retrieve infrastructure'}. The lookup uses OpenStreetMap Overpass servers; try again in a moment if they are busy.`)
    } finally {
      setLoadingInfrastructure(false)
    }
  }, [])

  useEffect(() => {
    if (selectedEvent) {
      loadInfrastructure(selectedEvent)
      if (eventId !== selectedEvent.event_id) navigate(`/impact-map/${selectedEvent.event_id}`, { replace: true })
    }
  }, [selectedEvent, loadInfrastructure, eventId, navigate])

  const chooseEvent = (event) => {
    setSelectedEvent(event)
    setCategoryFilter('all')
  }

  const categories = useMemo(
    () => [...new Set(infrastructure.map(item => item.category).filter(Boolean))].sort(),
    [infrastructure]
  )
  const visibleInfrastructure = useMemo(
    () => categoryFilter === 'all' ? infrastructure : infrastructure.filter(item => item.category === categoryFilter),
    [infrastructure, categoryFilter]
  )

  if (loadingEvents) {
    return <div className="flex items-center justify-center h-64"><div className="text-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" /><p style={{ color: 'var(--text-color)' }}>Loading seismic events…</p></div></div>
  }

  if (eventsError) {
    return <div className="morphic-card p-6 text-center"><h2 className="text-xl font-semibold mb-2">Unable to load impact map</h2><p className="mb-4 text-red-500">{eventsError}</p><button className="morphic-btn px-4 py-2" onClick={loadEvents}>Try again</button></div>
  }

  const selectedAnalysis = selectedEvent?.analysis || {}
  const affectedRadius = Number(radiusKm || selectedAnalysis.affected_radius_km || 0)

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold adaptive-title" style={{ color: 'var(--text-color)' }}>🗺️ Impact Map</h1>
          <p className="mt-1 opacity-70 adaptive-text" style={{ color: 'var(--text-color)' }}>OpenStreetMap critical infrastructure near the selected seismic event</p>
        </div>
        <div className="flex gap-2">
          <button className="morphic-btn-secondary px-3 py-2 text-sm" onClick={() => selectedEvent && loadInfrastructure(selectedEvent)} disabled={!selectedEvent || loadingInfrastructure}>↻ Refresh infrastructure</button>
          <button className="morphic-btn-secondary px-3 py-2 text-sm" onClick={() => setSidebarOpen(value => !value)}>{sidebarOpen ? '◀ Events' : '▶ Events'}</button>
        </div>
      </div>

      <div className="flex flex-1 gap-4 min-h-[520px]">
        {sidebarOpen && <aside className="w-72 shrink-0 morphic-card p-3 overflow-y-auto">
          <h2 className="font-semibold mb-3" style={{ color: 'var(--text-color)' }}>Seismic events ({events.length})</h2>
          {events.length === 0 ? <p className="text-sm opacity-60">No seismic events have been recorded yet.</p> : events.map(event => (
            <button key={event.event_id} onClick={() => chooseEvent(event)} className={`w-full text-left p-3 mb-2 rounded-xl border transition ${selectedEvent?.event_id === event.event_id ? 'border-blue-500 bg-blue-50/70' : 'border-transparent hover:border-gray-300'}`}>
              <div className="font-semibold text-sm truncate" style={{ color: 'var(--text-color)' }}>{event.event_name}</div>
              <div className="text-xs opacity-70 mt-1" style={{ color: 'var(--text-color)' }}>{formatDate(event.detected_at || event.created_at)}</div>
              <div className="text-xs opacity-70 mt-1" style={{ color: 'var(--text-color)' }}>{event.analysis?.affected_radius_km ?? '—'} km affected radius · {event.status}</div>
              {event.analysis?.epicenter_latitude == null && <div className="text-xs text-amber-600 mt-1">Epicenter pending</div>}
            </button>
          ))}
        </aside>}

        <section className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="morphic-card overflow-hidden h-[440px]">
            <MapContainer center={selectedEvent?.mapLatitude != null && selectedEvent?.mapLongitude != null ? [Number(selectedEvent.mapLatitude), Number(selectedEvent.mapLongitude)] : [30.3165, 78.0322]} zoom={selectedEvent?.mapLatitude != null && selectedEvent?.mapLongitude != null ? 11 : 6} scrollWheelZoom className="h-full w-full">
              <MapController event={selectedEvent} />
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {events.filter(event => event.mapLatitude != null && event.mapLongitude != null && Number.isFinite(Number(event.mapLatitude)) && Number.isFinite(Number(event.mapLongitude))).map(event => <Marker key={event.event_id} position={[Number(event.mapLatitude), Number(event.mapLongitude)]} icon={getEventIcon(selectedEvent?.event_id === event.event_id)} eventHandlers={{ click: () => chooseEvent(event) }}>
                <Popup><strong>{event.event_name}</strong><br />{formatDate(event.detected_at || event.created_at)}<br />Status: {event.status}</Popup>
              </Marker>)}
              {selectedEvent?.analysis?.epicenter_latitude != null && selectedEvent?.analysis?.epicenter_longitude != null && affectedRadius > 0 && <Circle center={[selectedEvent.analysis.epicenter_latitude, selectedEvent.analysis.epicenter_longitude]} radius={affectedRadius * 1000} pathOptions={{ color: '#f97316', fillColor: '#f97316', fillOpacity: 0.10, weight: 2, dashArray: '7 5' }} />}
              <MarkerClusterGroup chunkedLoading>
                {visibleInfrastructure.map(item => <Marker key={item.osm_id} position={[item.latitude, item.longitude]} icon={getInfrastructureIcon(item)}>
                  <Popup><div className="min-w-[190px]"><div className="font-bold mb-1">{INFRA_ICONS[item.amenity_type] || '📍'} {item.name || 'Unnamed structure'}</div><div className="text-sm">Type: {CATEGORY_LABELS[item.category] || item.category}</div><div className="text-xs opacity-70 mt-1">OpenStreetMap ID: {item.osm_id}</div></div></Popup>
                </Marker>)}
              </MarkerClusterGroup>
            </MapContainer>
          </div>

          <div className="morphic-card p-4">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
              <div><h2 className="font-bold text-lg" style={{ color: 'var(--text-color)' }}>Nearby mapped infrastructure</h2><p className="text-xs opacity-65" style={{ color: 'var(--text-color)' }}>{selectedEvent ? `${selectedEvent.event_name} · ${centerSource === 'station_location' ? 'Station-centred search' : centerSource === 'estimated_epicenter' ? 'Epicenter-centred search' : 'Location pending'} · ${affectedRadius || '—'} km radius` : 'Select an event to search nearby infrastructure'}</p></div>
              <span className="text-sm font-semibold px-3 py-1 rounded-full bg-blue-100 text-blue-800">{visibleInfrastructure.length} shown / {infrastructure.length} found</span>
            </div>

            {loadingInfrastructure && <div className="flex items-center gap-2 text-sm py-4"><span className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" /> Searching OpenStreetMap for nearby structures…</div>}
            {!loadingInfrastructure && infrastructureError && <div className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">{infrastructureError}</div>}
            {!loadingInfrastructure && !infrastructureError && infrastructure.length === 0 && <p className="text-sm opacity-65 py-3" style={{ color: 'var(--text-color)' }}>No mapped infrastructure was returned for this search area. This can mean OpenStreetMap has no mapped features there, not necessarily that no facilities exist.</p>}

            {infrastructure.length > 0 && <>
              <div className="flex flex-wrap gap-2 mb-3">
                <button onClick={() => setCategoryFilter('all')} className={`text-xs px-3 py-1.5 rounded-full ${categoryFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>All ({infrastructure.length})</button>
                {categories.map(category => <button key={category} onClick={() => setCategoryFilter(category)} className={`text-xs px-3 py-1.5 rounded-full ${categoryFilter === category ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>{CATEGORY_LABELS[category] || category} ({infrastructure.filter(item => item.category === category).length})</button>)}
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-gray-200">
                {visibleInfrastructure.map(item => <div key={item.osm_id} className="py-3 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-lg" style={{ background: `${CATEGORY_COLORS[item.category] || '#64748b'}18` }}>{INFRA_ICONS[item.amenity_type] || INFRA_ICONS.default}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm" style={{ color: 'var(--text-color)' }}>{item.name || 'Unnamed structure'}</div>
                    <div className="text-xs opacity-65" style={{ color: 'var(--text-color)' }}>{CATEGORY_LABELS[item.category] || item.category} · {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}</div>
                    {item.tags?.['addr:full'] && <div className="text-xs opacity-65">{item.tags['addr:full']}</div>}
                  </div>
                  <a className="text-xs text-blue-600 hover:underline shrink-0" href={`https://www.openstreetmap.org/${item.osm_id}`} target="_blank" rel="noreferrer">OSM ↗</a>
                </div>)}
              </div>
            </>}
            <p className="text-xs opacity-60 mt-3" style={{ color: 'var(--text-color)' }}>Source: OpenStreetMap via Overpass API. {centerSource === 'station_location' ? 'Search is centred on the sensor station, not an estimated earthquake epicenter. ' : ''}These are mapped facilities within the selected radius; proximity does not mean a structure is damaged or unsafe.</p>
          </div>
        </section>
      </div>
    </div>
  )
}

export default ImpactMap
