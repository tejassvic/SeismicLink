import React, { useState, useEffect } from 'react'
import { API_BASE_URL, APP_CONFIG } from '../config'

function Logs() {
  const [systemLogs, setSystemLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pagination, setPagination] = useState({ total_count: 0 });
  const [stats, setStats] = useState({});
  const [expandedDescriptions, setExpandedDescriptions] = useState(new Set());
  const [filterType, setFilterType] = useState('all');

  // Fetch system logs from backend
  useEffect(() => {
    const fetchSystemLogs = async () => {
      setLoading(true);
      setError('');
      
      try {
        const response = await fetch(`${API_BASE_URL}/api/v1/system-logs?page=${currentPage}`);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        setSystemLogs(data.logs || []);
        setStats(data.stats || {});
        setTotalPages(data.pagination?.total_pages || 1);
        setPagination(data.pagination || { total_count: 0 });
        setLoading(false);
      } catch (err) {
        setError(`Failed to fetch system logs: ${err.message}`);
        setLoading(false);
      }
    };

    fetchSystemLogs();
  }, [currentPage]);

  // Handle pagination
  const handlePreviousPage = () => { if (currentPage > 1) setCurrentPage(currentPage - 1); };
  const handleNextPage = () => { if (currentPage < totalPages) setCurrentPage(currentPage + 1); };
  const handleFirstPage = () => setCurrentPage(1);
  const handleLastPage = () => setCurrentPage(totalPages);
  const handlePageClick = (page) => setCurrentPage(page);

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

  // Helper function to truncate description
  const truncateDescription = (description, maxLength = 80) => {
    if (description.length <= maxLength) return description;
    return description.substring(0, maxLength) + '...';
  };

  // Helper function to toggle description expansion
  const toggleDescription = (logId) => {
    const newExpanded = new Set(expandedDescriptions);
    if (newExpanded.has(logId)) newExpanded.delete(logId);
    else newExpanded.add(logId);
    setExpandedDescriptions(newExpanded);
  };

  // Get event type badge styling
  const getEventTypeBadge = (eventType) => {
    switch (eventType) {
      case 'Seismic Event': return 'badge-red';
      case 'Map Update': return 'badge-blue';
      case 'Cap Alert': return 'badge-amber';
      default: return 'badge-gray';
    }
  };

  // Export logs as CSV
  const exportCSV = () => {
    const headers = ['ID', 'Date', 'Event Type', 'Description'];
    const rows = systemLogs.map(log => [
      log.id,
      log.date,
      log.event_type,
      `"${log.description.replace(/"/g, '""')}"`
    ]);
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Get event type icon
  const getEventTypeIcon = (eventType) => {
    switch (eventType) {
      case 'Seismic Event': return '🔴';
      case 'Map Update': return '🗺️';
      case 'Cap Alert': return '🚨';
      default: return '📝';
    }
  };

  // Filter logs by type
  const filteredLogs = filterType === 'all' 
    ? systemLogs 
    : systemLogs.filter(log => log.event_type === filterType);

  // Generate page numbers
  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;
    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push('...'); pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1); pages.push('...');
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1); pages.push('...');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
        pages.push('...'); pages.push(totalPages);
      }
    }
    return pages;
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-color)' }}>System Logs</h1>
          <p className="mt-1 opacity-70" style={{ color: 'var(--text-color)' }}>Track all system events, map updates, and CAP alerts</p>
        </div>
        <button
          onClick={exportCSV}
          className="btn-secondary text-sm"
          title="Download logs as CSV"
        >
          📥 Export CSV
        </button>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => <div key={i} className="h-28 rounded-xl bg-gray-200 animate-shimmer" />)}
          </div>
          <div className="h-64 rounded-xl bg-gray-200 animate-shimmer" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center animate-fade-in-up">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-red-800 mb-2">Error Loading Logs</h2>
          <p className="text-red-600">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in-up">
            <div className="stat-card bg-gradient-danger">
              <div className="relative z-10">
                <div className="text-3xl mb-2">🔴</div>
                <div className="text-3xl font-bold mb-1">{stats.seismic_event_count || 0}</div>
                <div className="text-sm opacity-90">Seismic Events</div>
              </div>
            </div>
            <div className="stat-card bg-gradient-info">
              <div className="relative z-10">
                <div className="text-3xl mb-2">🗺️</div>
                <div className="text-3xl font-bold mb-1">{stats.map_update_count || 0}</div>
                <div className="text-sm opacity-90">Map Updates</div>
              </div>
            </div>
            <div className="stat-card bg-gradient-warning">
              <div className="relative z-10">
                <div className="text-3xl mb-2">🚨</div>
                <div className="text-3xl font-bold mb-1">{stats.cap_alert_count || 0}</div>
                <div className="text-sm opacity-90">Alerts Generated</div>
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="glass rounded-xl p-4 animate-fade-in-up">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-gray-700">Filter by type:</span>
              {['all', 'Seismic Event', 'Map Update', 'Cap Alert'].map(type => (
                <button
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                    filterType === type
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {type === 'all' ? 'All Events' : type}
                </button>
              ))}
              <div className="flex-1" />
              <span className="text-sm text-gray-500">
                {pagination.total_count} total entries
              </span>
            </div>
          </div>

          {/* Logs Table */}
          <div className="table-container animate-fade-in-up">
            <table className="min-w-full">
              <thead className="table-header">
                <tr>
                  <th>ID</th>
                  <th>Date</th>
                  <th>Event Type</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody className="table-body">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-gray-500">
                      <div className="text-4xl mb-2">📭</div>
                      <p>No logs found for this filter</p>
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log, idx) => (
                    <tr key={log.id} className={idx % 2 === 0 ? '' : 'bg-gray-50/50'}>
                      <td className="font-mono text-gray-500">#{log.id}</td>
                      <td className="text-gray-700 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-xs">{formatDate(log.date)}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${getEventTypeBadge(log.event_type)}`}>
                          <span className="mr-1">{getEventTypeIcon(log.event_type)}</span>
                          {log.event_type}
                        </span>
                      </td>
                      <td className="text-gray-700 max-w-md">
                        <div>
                          <span className={expandedDescriptions.has(log.id) ? '' : 'line-clamp-2'}>
                            {expandedDescriptions.has(log.id)
                              ? log.description
                              : truncateDescription(log.description)
                            }
                          </span>
                          {log.description.length > 80 && (
                            <button
                              onClick={() => toggleDescription(log.id)}
                              className="ml-2 text-blue-600 hover:text-blue-800 text-xs font-medium hover:underline focus:outline-none"
                            >
                              {expandedDescriptions.has(log.id) ? 'Show Less' : 'Show More'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-col items-center space-y-3 animate-fade-in-up">
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
            <p className="text-sm text-gray-500">
              Page {currentPage} of {totalPages} · {pagination.total_count} total items
            </p>
          </div>
        </>
      )}
    </div>
  )
}

export default Logs