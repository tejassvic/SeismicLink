import React from 'react'

function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="text-center">
        {/* Animated globe */}
        <div className="relative w-24 h-24 mx-auto mb-8">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-400 to-purple-600 animate-ping opacity-20" />
          <div className="absolute inset-2 rounded-full bg-gradient-to-br from-blue-500 to-purple-700 flex items-center justify-center text-5xl animate-pulse shadow-2xl shadow-blue-500/50">
            🌍
          </div>
          {/* Orbiting ring */}
          <div className="absolute inset-0 rounded-full border-2 border-blue-400/30 animate-spin" style={{ animationDuration: '3s' }} />
          <div className="absolute inset-2 rounded-full border-2 border-purple-400/20 animate-spin" style={{ animationDuration: '4s', animationDirection: 'reverse' }} />
        </div>

        {/* Brand */}
        <h1 className="text-3xl font-bold text-white mb-2 animate-fade-in-up">
          Seismic Link
        </h1>
        <p className="text-blue-300/70 text-sm mb-8 animate-fade-in-up">
          Loading seismic data...
        </p>

        {/* Loading bar */}
        <div className="w-48 h-1.5 mx-auto bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full animate-pulse" 
               style={{ width: '60%', animation: 'loadingBar 1.5s ease-in-out infinite' }} />
        </div>
      </div>
    </div>
  )
}

export default LoadingScreen