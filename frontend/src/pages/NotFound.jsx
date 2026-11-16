import React from 'react'
import { Link } from 'react-router-dom'

function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center animate-scale-in">
        <div className="text-8xl mb-6">🌍</div>
        <h1 className="text-6xl font-bold text-gray-900 mb-4">404</h1>
        <h2 className="text-2xl font-semibold text-gray-700 mb-4">Page Not Found</h2>
        <p className="text-gray-500 mb-8 max-w-md mx-auto">
          The page you're looking for doesn't exist or has been moved.
          Let's get you back to safety.
        </p>
        <Link to="/" className="btn-primary px-8 py-3 text-base">
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  )
}

export default NotFound