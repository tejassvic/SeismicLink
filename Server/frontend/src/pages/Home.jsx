import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE_URL, APP_CONFIG } from '../config'

// Skeleton loading component
function EventCardSkeleton() {
  return (
    <div className="skeleton-card animate-fade-in-up">
      <div className="skeleton-image animate-shimmer" />
      <div className="skeleton-content">
        <div className="skeleton-line w-1/3 animate-shimmer" />
        <div className="skeleton-line animate-shimmer" />
        <div className="skeleton-line-sm animate-shimmer" />
        <div className="skeleton-line-sm animate-shimmer" />
      </div>
    </div>
  )
}

// Stat card component
function StatCard({ icon, label, value, gradient, delay }) {
  return (
    <div className={`stat-card ${gradient} animate-fade-in-up`} style={{ animationDelay: `${delay * 0.1}s` }}>
      <div className="relative z-10">
        <div className="text-3xl mb-2">{icon}</div>
        <div className="text-3xl font-bold mb-1">{value}</div>
        <div className="text-sm opacity-90">{label}</div>
      </div>
    </div>
  )
}

function Home() {
  const [earthquakeEvents, setEarthquakeEvents] = useState([]);
  const [systemLogs, setSystemLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pagination, setPagination] = useState({ total_count: 0 });
  const [logsStats, setLogsStats] = useState({});
  const [expandedEvents, setExpandedEvents] = useState(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [eventRes, logRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/v1/earthquake-events?page=${currentPage}&page_size=50`),
        fetch(`${API_BASE_URL}/api/v1/system-logs?page=1&page_size=1`)
      ]);

      if (!eventRes.ok) {
        throw new Error(`HTTP error! status: ${eventRes.status}`);
      }

      const eventData = await eventRes.json();
      const logData = logRes.ok ? await logRes.json() : {};

      setEarthquakeEvents(eventData.events || []);
      setTotalPages(eventData.pagination?.total_pages || 1);
      setPagination(eventData.pagination || { total_count: 0 });
      setLogsStats(logData.stats || {});
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      setError(`Failed to fetch data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [currentPage]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, APP_CONFIG.AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  // Handle pagination
  const handlePreviousPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };
  const handleNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };
  const handleFirstPage = () => setCurrentPage(1);
  const handleLastPage = () => setCurrentPage(totalPages);
  const handlePageClick = (page) => setCurrentPage(page);

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;
    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push('...');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      }
    }
    return pages;
  };

  // Handle accordion toggle
  const toggleAccordion = (eventId) => {
    setExpandedEvents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) newSet.delete(eventId);
      else newSet.add(eventId);
      return newSet;
    });
  };

  // Helper function to format date
  const formatDate = (dateString) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    } catch (error) {
      return dateString;
    }
  };

  // Get magnitude background gradient
  const getMagnitudeBg = (mag) => {
    if (mag >= 7) return 'from-red-500 to-red-700';
    if (mag >= 5) return 'from-orange-400 to-orange-600';
    if (mag >= 3) return 'from-amber-400 to-amber-600';
    return 'from-blue-400 to-blue-600';
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-color)' }}>Dashboard</h1>
          <p className="mt-1 opacity-70" style={{ color: 'var(--text-color)' }}>Real-time seismic event monitoring and analysis</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              autoRefresh
                ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
            {autoRefresh ? 'Auto-refresh On' : 'Auto-refresh'}
          </button>
          {lastUpdated && (
            <span className="text-xs opacity-60" style={{ color: 'var(--text-color)' }}>
              Updated: {lastUpdated}
            </span>
          )}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-32 rounded-xl bg-gray-200 animate-shimmer" />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <EventCardSkeleton key={i} />
            ))}
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center animate-fade-in-up">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-red-800 mb-2">Error Loading Data</h2>
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={fetchData} className="btn-primary">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard
              icon="🔴"
              label="Seismic Events"
              value={logsStats.seismic_event_count || 0}
              gradient="bg-gradient-danger"
              delay={1}
            />
            <StatCard
              icon="🗺️"
              label="Map Updates"
              value={logsStats.map_update_count || 0}
              gradient="bg-gradient-info"
              delay={2}
            />
            <StatCard
              icon="🚨"
              label="Alerts Generated"
              value={logsStats.cap_alert_count || 0}
              gradient="bg-gradient-warning"
              delay={3}
            />
          </div>

          {/* Urgency Legend */}
          <div className="glass rounded-xl p-6 animate-fade-in-up">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-sm font-medium" style={{ color: 'var(--text-color)' }}>
                ℹ️ Click on an event card to view its impact map
              </p>
              <div className="flex items-center gap-4">
                <span className="text-xs font-medium opacity-60" style={{ color: 'var(--text-color)' }}>Urgency:</span>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <span className="text-xs text-red-600 font-medium">High</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span className="text-xs text-amber-600 font-medium">Medium</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-xs text-emerald-600 font-medium">Low</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Empty State */}
          {earthquakeEvents.length === 0 && (
            <div className="text-center py-16 animate-fade-in-up">
              <div className="text-6xl mb-4">📡</div>
              <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-color)' }}>No Events Detected</h2>
              <p className="opacity-60 max-w-md mx-auto" style={{ color: 'var(--text-color)' }}>
                Waiting for seismic data. The scraper bot will automatically populate events as they are detected.
              </p>
            </div>
          )}

          {/* Latest Seismic Events */}
          {earthquakeEvents.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-color)' }}>Latest Seismic Events</h2>
                <span className="text-sm opacity-60" style={{ color: 'var(--text-color)' }}>
                  {pagination.total_count} total events
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {earthquakeEvents.slice(0, 9).map((event, index) => (
                  <div
                    key={event.event_id}
                    className="rounded-xl shadow-sm border overflow-hidden hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 animate-fade-in-up"
                    style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)', animationDelay: `${(index % 9) * 0.1}s` }}
                  >
                    {/* Event Header */}
                    <Link
                      to={`/impact/${event.event_id}`}
                      className="block p-5"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r ${getMagnitudeBg(event.magnitude)} text-white text-sm font-bold shadow-sm`}>
                          <span className="text-lg">{event.magnitude}</span>
                          <span className="text-xs opacity-80">M</span>
                        </div>

                        {event.critical_infrastructure && event.critical_infrastructure.length > 0 && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleAccordion(event.event_id);
                            }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            title="Toggle infrastructure details"
                          >
                            <svg className={`w-5 h-5 transition-transform duration-200 ${
                              expandedEvents.has(event.event_id) ? 'rotate-180' : ''
                            }`} style={{ color: 'var(--text-color)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        )}
                      </div>

                      <h3 className="font-semibold mb-1 line-clamp-1" style={{ color: 'var(--text-color)' }}>{event.event_name}</h3>
                      <p className="text-sm mb-1 opacity-60" style={{ color: 'var(--text-color)' }}>{formatDate(event.origin_time)}</p>
                      
                      <div className="flex items-center gap-3 text-xs mt-2 opacity-50" style={{ color: 'var(--text-color)' }}>
                        <span className="flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-gray-400" />
                          {event.depth_km} km depth
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-gray-400" />
                          {event.critical_infrastructure?.length || 0} infrastructures
                        </span>
                      </div>
                    </Link>

                    {/* Critical Infrastructure Accordion */}
                    {event.critical_infrastructure && event.critical_infrastructure.length > 0 && (
                      <div className={`border-t transition-all duration-300 ease-in-out ${
                        expandedEvents.has(event.event_id)
                          ? 'max-h-96 opacity-100'
                          : 'max-h-0 opacity-0'
                      } overflow-hidden`} style={{ borderColor: 'var(--card-border)' }}>
                        <div className="p-5 pt-4">
                          <p className="text-xs font-semibold uppercase tracking-wider mb-2 opacity-60" style={{ color: 'var(--text-color)' }}>
                            Critical Infrastructure
                          </p>
                          <div className="space-y-1.5 max-h-40 overflow-y-auto">
                            {event.critical_infrastructure.map((infra, index) => {
                              const urgencyColor =
                                infra.urgency === 'High' ? 'text-red-600' :
                                infra.urgency === 'Medium' ? 'text-amber-600' :
                                infra.urgency === 'Low' ? 'text-emerald-600' : 'text-gray-600';
                              const dotColor =
                                infra.urgency === 'High' ? 'bg-red-500' :
                                infra.urgency === 'Medium' ? 'bg-amber-500' :
                                infra.urgency === 'Low' ? 'bg-emerald-500' : 'bg-gray-400';
                              return (
                                <div key={index} className={`flex items-center gap-2 text-sm ${urgencyColor}`}>
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                                  <span className="truncate">{infra.name}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex flex-col items-center mt-8 space-y-3">
                  <nav className="flex items-center gap-1">
                    <button onClick={handleFirstPage} disabled={currentPage === 1}
                      className={`pagination-btn ${currentPage === 1 ? 'text-gray-300 cursor-not-allowed' : 'pagination-btn-inactive'}`}
                      title="First page">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M15.707 15.707a1 1 0 01-1.414 0l-5-5a1 1 0 010-1.414l5-5a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 010 1.414zM7.707 15.707a1 1 0 01-1.414 0l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 1.414L3.414 10l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <button onClick={handlePreviousPage} disabled={currentPage === 1}
                      className={`pagination-btn ${currentPage === 1 ? 'text-gray-300 cursor-not-allowed' : 'pagination-btn-inactive'}`}
                      title="Previous page">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </button>
                    {getPageNumbers().map((page, index) => (
                      page === '...' ? (
                        <span key={index} className="pagination-btn text-gray-400 cursor-default">...</span>
                      ) : (
                        <button key={index} onClick={() => handlePageClick(page)}
                          className={`pagination-btn ${currentPage === page ? 'pagination-btn-active' : 'pagination-btn-inactive'}`}>
                          {page}
                        </button>
                      )
                    ))}
                    <button onClick={handleNextPage} disabled={currentPage === totalPages}
                      className={`pagination-btn ${currentPage === totalPages ? 'text-gray-300 cursor-not-allowed' : 'pagination-btn-inactive'}`}
                      title="Next page">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <button onClick={handleLastPage} disabled={currentPage === totalPages}
                      className={`pagination-btn ${currentPage === totalPages ? 'text-gray-300 cursor-not-allowed' : 'pagination-btn-inactive'}`}
                      title="Last page">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414zM12.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L16.586 10l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </nav>
                  <p className="text-sm opacity-60" style={{ color: 'var(--text-color)' }}>
                    Page {currentPage} of {totalPages} · {pagination.total_count} total items
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default Home