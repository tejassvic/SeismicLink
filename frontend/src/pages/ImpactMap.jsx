import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../config'
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import MarkerClusterGroup from 'react-leaflet-cluster'

// Fix for default markers
import L from 'leaflet'
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

const INFRA_ICONS = {
  hospital: '🏥',
  school: '🎓',
  fire_station: '🔥',
  police: '👮',
  airport: '✈️',
  bus_station: '🚌',
  power_station: '⚡',
  shelter: '🏠',
  clinic: '💊',
  university: '🎓',
  default: '📍',
}

function getInfrastructureIcon(urgency, category) {
  const color = urgency === 'High' ? '#ef4444' :
    urgency === 'Medium' ? '#f59e0b' :
    urgency === 'Low' ? '#10b981' : '#6b7280'
  const size = urgency === 'High' ? 16 : urgency === 'Medium' ? 12 : 10

  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="
      background: ${color};
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      border: 2px solid white;
      box-shadow: 0 0 8px ${color}66, 0 2px 6px rgba(0,0,0,0.2);
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function getEventIcon(isSelected = false) {
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="
      width: ${isSelected ? 32 : 24}px;
      height: ${isSelected ? 32 : 24}px;
      background: linear-gradient(135deg, #ef4444, #dc2626);
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 3px solid white;
      box-shadow: 0 0 ${isSelected ? 20 : 8}px rgba(239,68,68,0.5);
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      animation: ${isSelected ? 'pulse-glow 1.5s ease-in-out infinite' : 'none'};
    ">
      <div style="
        position: absolute;
        top: 5px;
        left: 5px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: white;
      "></div>
    </div>`,
    iconSize: isSelected ? [32, 32] : [24, 24],
    iconAnchor: isSelected ? [16, 32] : [12, 24],
  })
}

// Map controller for centering
function MapController({ selectedEvent, flyTo }) {
  const map = useMap()
  useEffect(() => {
    if (selectedEvent && flyTo) {
      map.flyTo([selectedEvent.latitude, selectedEvent.longitude], 12, {
        duration: 1.2,
        easeLinearity: 0.25
      })
    }
  }, [selectedEvent, map, flyTo])
  return null
}

// Event selector panel item
function EventSelectorItem({ event, isSelected, onClick, isFrequent }) {
  const magColor = event.magnitude >= 7 ? 'from-red-500 to-red-700' :
    event.magnitude >= 5 ? 'from-orange-400 to-orange-600' :
    event.magnitude >= 3 ? 'from-amber-400 to-amber-600' : 'from-blue-400 to-blue-600'

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl transition-all duration-300 ${
        isSelected
          ? 'bg-blue-50 border-2 border-blue-500 shadow-md scale-[1.02]'
          : 'hover:bg-gray-50 border-2 border-transparent hover:border-gray-200'
      } ${isFrequent ? 'ring-2 ring-amber-300' : ''}`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${magColor} flex items-center justify-center text-white font-bold text-sm shadow-sm shrink-0`}>
          {event.magnitude}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-color)' }}>
            {event.event_name}
          </p>
          <p className="text-xs opacity-60" style={{ color: 'var(--text-color)' }}>
            {event.depth_km}km depth · {event.critical_infrastructure?.length || 0} structures
          </p>
        </div>
        {isSelected && <span className="text-blue-500 text-lg">✓</span>}
      </div>
    </button>
  )
}

// Enhanced popup content
function EnhancedPopup({ event, darkMode = false }) {
  const formatDate = (d) => {
    try {
      return new Date(d).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    } catch { return d }
  }

  const titleColor = darkMode ? '#f1f5f9' : '#111827'
  const mutedColor = darkMode ? '#94a3b8' : '#6b7280'
  const borderColor = darkMode ? '#334155' : '#f3f4f6'
  const valueColor = darkMode ? '#f1f5f9' : '#111827'

  return (
    <div className="min-w-[260px] p-1">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
          {event.magnitude}
        </div>
        <div>
          <h3 className="font-bold text-base" style={{ color: titleColor }}>{event.event_name}</h3>
          <p className="text-xs" style={{ color: mutedColor }}>{event.event_type}</p>
        </div>
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between py-1" style={{ borderBottom: `1px solid ${borderColor}` }}>
          <span style={{ color: mutedColor }}>Magnitude</span>
          <span className="font-semibold" style={{ color: valueColor }}>{event.magnitude}</span>
        </div>
        <div className="flex justify-between py-1" style={{ borderBottom: `1px solid ${borderColor}` }}>
          <span style={{ color: mutedColor }}>Depth</span>
          <span className="font-semibold" style={{ color: valueColor }}>{event.depth_km} km</span>
        </div>
        <div className="flex justify-between py-1" style={{ borderBottom: `1px solid ${borderColor}` }}>
          <span style={{ color: mutedColor }}>Location</span>
          <span className="font-semibold" style={{ color: valueColor }}>{event.latitude?.toFixed(3)}, {event.longitude?.toFixed(3)}</span>
        </div>
        <div className="flex justify-between py-1">
          <span style={{ color: mutedColor }}>Time</span>
          <span className="font-semibold" style={{ color: valueColor }}>{formatDate(event.origin_time)}</span>
        </div>
      </div>
    </div>
  )
}

function ImpactMap({ darkMode = false }) {
  const { eventId } = useParams()
  const navigate = useNavigate()
  const [earthquakeEvents, setEarthquakeEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [flyTo, setFlyTo] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [filterUrgency, setFilterUrgency] = useState('all')
  const [showHeatmap, setShowHeatmap] = useState(false)

  // Track usage for frequent event selection
  const [frequentEvents] = useState(() => {
    try {
      const saved = localStorage.getItem('seismo_frequent_events')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/earthquake-events?page=1&page_size=50`)
        if (!res.ok) {
          setError('Failed to fetch earthquake data')
          setLoading(false)
          return
        }
        const data = await res.json()
        setEarthquakeEvents(data.events || [])
        
        if (eventId) {
          const event = data.events.find(e => e.event_id === eventId)
          if (event) {
            setSelectedEvent(event)
            setFlyTo(true)
          }
        }
        setLoading(false)
      } catch {
        setError('Network error: Unable to connect to the server')
        setLoading(false)
      }
    }
    fetchEvents()
  }, [eventId])

  const handleEventSelect = useCallback((event) => {
    setSelectedEvent(event)
    setFlyTo(true)
    // Track frequent events
    try {
      const saved = localStorage.getItem('seismo_frequent_events')
      const freq = saved ? new Set(JSON.parse(saved)) : new Set()
      freq.add(event.event_id)
      localStorage.setItem('seismo_frequent_events', JSON.stringify([...freq]))
    } catch {}
  }, [])

  // Get max magnitude for stats
  const maxMagnitude = earthquakeEvents.length > 0
    ? Math.max(...earthquakeEvents.map(e => e.magnitude || 0))
    : 0
  const avgDepth = earthquakeEvents.length > 0
    ? (earthquakeEvents.reduce((s, e) => s + (e.depth_km || 0), 0) / earthquakeEvents.length).toFixed(1)
    : 0

  // Filter all infrastructure by urgency
  const allInfrastructures = earthquakeEvents.flatMap(event =>
    (event.critical_infrastructure || [])
      .filter(infra => filterUrgency === 'all' || infra.urgency === filterUrgency)
      .map((infra, idx) => ({ ...infra, event, key: `${event.event_id}-${infra.id || idx}` }))
  ).filter(infra => typeof infra.latitude === 'number' && typeof infra.longitude === 'number')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-lg" style={{ color: 'var(--text-color)' }}>Loading map data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-color)' }}>Error Loading Data</h2>
          <p className="mb-4" style={{ color: 'var(--text-color)' }}>{error}</p>
          <button onClick={() => window.location.reload()} className="morphic-btn">
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold adaptive-title" style={{ color: 'var(--text-color)' }}>🗺️ Impact Map</h1>
          <p className="mt-1 opacity-70 adaptive-text" style={{ color: 'var(--text-color)' }}>
            Visualize seismic events and critical infrastructure
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={`px-3 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${
              showHeatmap ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'morphic-btn-secondary'
            }`}
          >
            {showHeatmap ? '🔥 Heatmap On' : 'Heatmap'}
          </button>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="morphic-btn-secondary px-3 py-2 text-sm"
          >
            {sidebarOpen ? '◀ Events' : '▶ Events'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Event Selector Sidebar */}
        {sidebarOpen && (
          <div className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto animate-slide-in">
            {/* Urgency Filter */}
            <div className="morphic-card p-3">
              <div className="flex items-center gap-1.5">
                {[
                  { key: 'all', label: 'All', color: 'bg-gray-500' },
                  { key: 'High', label: 'High', color: 'bg-red-500' },
                  { key: 'Medium', label: 'Med', color: 'bg-amber-500' },
                  { key: 'Low', label: 'Low', color: 'bg-emerald-500' },
                ].map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFilterUrgency(f.key)}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                      filterUrgency === f.key
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'hover:bg-gray-100 text-gray-600'
                    }`}
                  >
                    <span className={`inline-block w-2 h-2 rounded-full ${f.color} mr-1`} />
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Event List */}
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {earthquakeEvents.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm opacity-60" style={{ color: 'var(--text-color)' }}>No events available</p>
                </div>
              ) : (
                earthquakeEvents.map((event, idx) => (
                  <div key={event.event_id} className="animate-fade-in-up" style={{ animationDelay: `${idx * 0.05}s` }}>
                    <EventSelectorItem
                      event={event}
                      isSelected={selectedEvent?.event_id === event.event_id}
                      onClick={() => handleEventSelect(event)}
                      isFrequent={frequentEvents.has(event.event_id)}
                    />
                  </div>
                ))
              )}
            </div>

            {/* Stats Summary */}
            <div className="morphic-card p-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold text-blue-600">{earthquakeEvents.length}</p>
                  <p className="text-xs opacity-60" style={{ color: 'var(--text-color)' }}>Events</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-orange-600">{maxMagnitude}</p>
                  <p className="text-xs opacity-60" style={{ color: 'var(--text-color)' }}>Max Mag</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-emerald-600">{avgDepth}</p>
                  <p className="text-xs opacity-60" style={{ color: 'var(--text-color)' }}>Avg Depth</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Map Container */}
        <div className="flex-1 morphic-card overflow-hidden">
          <MapContainer
            center={selectedEvent ? [selectedEvent.latitude, selectedEvent.longitude] : [22.5726, 88.3639]}
            zoom={selectedEvent ? 10 : 5}
            scrollWheelZoom={true}
            className="h-full w-full"
          >
            <MapController selectedEvent={selectedEvent} flyTo={flyTo} />

            {/* Dark/satellite tile layer */}
            <TileLayer
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />

            {/* Event Markers */}
            {earthquakeEvents.map(event => (
              <Marker
                key={event.event_id}
                position={[event.latitude, event.longitude]}
                icon={getEventIcon(selectedEvent?.event_id === event.event_id)}
                eventHandlers={{ click: () => handleEventSelect(event) }}
              >
                <Popup>
                  <EnhancedPopup event={event} darkMode={darkMode} />
                </Popup>
              </Marker>
            ))}

            {/* Impact Radius Circles for selected event */}
            {selectedEvent && (
              <>
                {selectedEvent.max_radius_adj && (
                  <Circle
                    center={[selectedEvent.latitude, selectedEvent.longitude]}
                    radius={selectedEvent.max_radius_adj * 1000}
                    pathOptions={{
                      color: '#eab308',
                      fillColor: '#eab308',
                      fillOpacity: 0.08,
                      weight: 2,
                      dashArray: '8, 4',
                    }}
                  />
                )}
                {selectedEvent.empirical_radius_adj && (
                  <Circle
                    center={[selectedEvent.latitude, selectedEvent.longitude]}
                    radius={selectedEvent.empirical_radius_adj * 1000}
                    pathOptions={{
                      color: '#f97316',
                      fillColor: '#f97316',
                      fillOpacity: 0.12,
                      weight: 2,
                    }}
                  />
                )}
                {selectedEvent.strong_radius_adj && (
                  <Circle
                    center={[selectedEvent.latitude, selectedEvent.longitude]}
                    radius={selectedEvent.strong_radius_adj * 1000}
                    pathOptions={{
                      color: '#ef4444',
                      fillColor: '#ef4444',
                      fillOpacity: 0.15,
                      weight: 3,
                    }}
                  />
                )}
              </>
            )}

            {/* Critical Infrastructure Markers */}
            <MarkerClusterGroup
              chunkedLoading
              iconCreateFunction={(cluster) => {
                const count = cluster.getChildCount()
                let colorClass = 'cluster-small'
                if (count > 100) colorClass = 'cluster-large'
                else if (count > 50) colorClass = 'cluster-medium'
                return L.divIcon({
                  html: `<div class="custom-cluster-icon ${colorClass}">${count}</div>`,
                  className: 'custom-cluster-wrapper',
                  iconSize: L.point(40, 40),
                })
              }}
            >
              {allInfrastructures.map(infra => (
                <Marker
                  key={infra.key}
                  position={[infra.latitude, infra.longitude]}
                  icon={getInfrastructureIcon(infra.urgency, infra.amenity_type)}
                >
                  <Popup>
                    <div className="min-w-[200px] p-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">{INFRA_ICONS[infra.amenity_type] || INFRA_ICONS.default}</span>
                        <h3 className="font-bold" style={{ color: darkMode ? '#f1f5f9' : '#111827' }}>{infra.name || 'Infrastructure'}</h3>
                      </div>
                    <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span style={{ color: darkMode ? '#94a3b8' : '#6b7280' }}>Category</span>
                          <span className="font-medium" style={{ color: darkMode ? '#f1f5f9' : '#111827' }}>{infra.category || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: darkMode ? '#94a3b8' : '#6b7280' }}>Event</span>
                          <span className="font-medium" style={{ color: darkMode ? '#f1f5f9' : '#111827' }}>{infra.event.event_name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: darkMode ? '#94a3b8' : '#6b7280' }}>Urgency</span>
                          <span className={`font-semibold ${
                            infra.urgency === 'High' ? 'text-red-600' :
                            infra.urgency === 'Medium' ? 'text-amber-600' : 'text-emerald-600'
                          }`}>{infra.urgency}</span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: darkMode ? '#94a3b8' : '#6b7280' }}>Distance</span>
                          <span className="font-semibold" style={{ color: darkMode ? '#f1f5f9' : '#111827' }}>{infra.distance_km || infra.distance_meters ? (infra.distance_km || (infra.distance_meters / 1000).toFixed(1)) + ' km' : 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          </MapContainer>

          {/* Map Legend */}
          <div className="map-legend">
            <h4 className="map-legend-title">Impact Radius</h4>
            <div className="space-y-1.5">
              <div className="map-legend-item">
                <span className="w-3 h-0.5 rounded bg-red-500" />
                <span>Strong ({selectedEvent?.strong_radius_adj || 0} km)</span>
              </div>
              <div className="map-legend-item">
                <span className="w-3 h-0.5 rounded bg-orange-500" />
                <span>Moderate ({selectedEvent?.empirical_radius_adj || 0} km)</span>
              </div>
              <div className="map-legend-item">
                <span className="w-3 h-0.5 rounded bg-yellow-500" style={{ borderStyle: 'dashed' }} />
                <span>Max ({selectedEvent?.max_radius_adj || 0} km)</span>
              </div>
            </div>
            <div className="border-t border-gray-200 mt-2 pt-2">
              <h4 className="map-legend-title">Infrastructure</h4>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-3 h-3 rounded-full bg-red-500" /> High
                <span className="w-3 h-3 rounded-full bg-amber-500" /> Med
                <span className="w-3 h-3 rounded-full bg-emerald-500" /> Low
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ImpactMap