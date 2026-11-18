/**
 * Application configuration
 * Centralized API URL and app settings
 * 
 * In development (Vite dev server), API requests are proxied via Vite's proxy config.
 * In production, set VITE_API_URL to your backend URL.
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const APP_CONFIG = {
  APP_NAME: 'Seismic Link',
  APP_TAGLINE: 'Live Seismic Monitoring',
  PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 100,
  AUTO_REFRESH_INTERVAL: 30000, // 30 seconds
};