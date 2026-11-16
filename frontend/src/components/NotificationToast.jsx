import React, { createContext, useContext, useState, useCallback } from 'react'

const NotificationContext = createContext()

export function useNotifications() {
  return useContext(NotificationContext)
}

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([])

  const addNotification = useCallback((message, type = 'info', duration = 5000) => {
    const id = Date.now() + Math.random()
    setNotifications(prev => [...prev, { id, message, type }])
    if (duration > 0) {
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id))
      }, duration)
    }
  }, [])

  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  return (
    <NotificationContext.Provider value={{ addNotification, removeNotification }}>
      {children}
      {/* Toast Container */}
      <div className="toast-container">
        {notifications.map(notification => (
          <div key={notification.id} className={`toast toast-${notification.type}`}>
            <span className="text-lg">
              {notification.type === 'success' ? '✅' :
               notification.type === 'error' ? '❌' :
               notification.type === 'warning' ? '⚠️' : 'ℹ️'}
            </span>
            <span className="flex-1">{notification.message}</span>
            <button
              onClick={() => removeNotification(notification.id)}
              className="p-1 hover:opacity-70 transition-opacity"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  )
}