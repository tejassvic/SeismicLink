/**
 * Hook to track page usage frequency and adapt UI accordingly.
 * Persists data in localStorage for personalized experience.
 */
import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'seismo_usage_tracker'

export function useUsageTracker() {
  const [usageData, setUsageData] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })

  // Track a page visit
  const trackPage = useCallback((page) => {
    setUsageData(prev => {
      const now = Date.now()
      const updated = {
        ...prev,
        [page]: {
          count: (prev[page]?.count || 0) + 1,
          lastVisited: now,
          firstVisited: prev[page]?.firstVisited || now,
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }, [])

  // Track an element interaction
  const trackInteraction = useCallback((key) => {
    setUsageData(prev => {
      const now = Date.now()
      const updated = {
        ...prev,
        [key]: {
          count: (prev[key]?.count || 0) + 1,
          lastVisited: now,
          firstVisited: prev[key]?.firstVisited || now,
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }, [])

  // Get sorted pages by frequency (most visited first)
  const getSortedPages = useCallback(() => {
    return Object.entries(usageData)
      .filter(([key]) => !key.startsWith('interaction_'))
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([page]) => page)
  }, [usageData])

  // Check if an element is "frequently used"
  const isFrequent = useCallback((key, threshold = 3) => {
    return (usageData[key]?.count || 0) >= threshold
  }, [usageData])

  return { usageData, trackPage, trackInteraction, getSortedPages, isFrequent }
}