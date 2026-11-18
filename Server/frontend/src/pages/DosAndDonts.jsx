import React, { useState } from 'react';

const earthquakeData = [
  {
    phase: "Before an Earthquake",
    icon: "🛡️",
    description: "Prepare and plan ahead to stay safe",
    image: "/before.jpeg",
    dos: [
      "Follow and advocate local safe building codes for earthquake-resistant construction.",
      "Follow and advocate upgrading poorly built structures.",
      "Identify medical centers, fire stations, and organize rescue mock drills.",
      "Know the electric and water shut-off locations in your house.",
      "Keep heavy objects, glasses, and cutlery on lower shelves.",
      "Avoid placing flower pots on parapets."
    ],
    donts: [
      "Don't ignore local building codes and construction standards.",
      "Don't delay in making an emergency preparedness plan.",
      "Don't block access to emergency exits or utility shut-offs.",
      "Don't place fragile or heavy items on high shelves.",
      "Don't leave unsecured items that could fall during shaking."
    ]
  },
  {
    phase: "During an Earthquake",
    icon: "🏃",
    description: "Stay calm and take cover",
    image: "/during.jpeg",
    dos: [
      "Keep calm and reassure others.",
      "If outdoors, move to an open space away from buildings and wires.",
      "If indoors, take cover under sturdy furniture or door frames.",
      "Stay away from glass windows, doors, and outside walls.",
      "If in a vehicle, stop safely and stay inside.",
      "Free all pets and domestic animals.",
      "Extinguish any open flames immediately."
    ],
    donts: [
      "Don't panic or cause panic in others.",
      "Don't rush out of the building—avoid stampedes.",
      "Don't use elevators.",
      "Don't use matches or candles (risk of gas leaks).",
      "Don't stand near trees, poles, or buildings while outside."
    ]
  },
  {
    phase: "After an Earthquake",
    icon: "🔍",
    description: "Stay vigilant and help others",
    image: "/after.jpeg",
    dos: [
      "Keep stock of clean water, food, and first-aid supplies.",
      "Help the injured and inform hospitals as needed.",
      "Listen to radio/TV for aftershock alerts and updates.",
      "Be prepared for aftershocks.",
      "Turn off gas valves and power if needed.",
      "Open doors and cupboards carefully—items may fall."
    ],
    donts: [
      "Don't spread or believe rumors.",
      "Don't use electrical switches if gas leak is suspected.",
      "Don't reopen gas valves until verified safe.",
      "Don't drink unverified water—risk of contamination.",
      "Don't ignore injuries—seek help immediately."
    ]
  }
];

function PhaseCard({ phase, index, isExpanded, onToggle }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden transition-all duration-300 hover:shadow-md">
      {/* Phase Header */}
      <button
        onClick={onToggle}
        className="w-full p-6 flex items-center justify-between hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-2xl shadow-lg shrink-0">
            {phase.icon}
          </div>
          <div className="text-left">
            <h2 className="text-xl font-bold text-gray-900">{phase.phase}</h2>
            <p className="text-sm text-gray-500">{phase.description}</p>
          </div>
        </div>
        <svg
          className={`w-6 h-6 text-gray-400 transition-transform duration-300 ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expandable Content */}
      <div
        className={`transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        } overflow-hidden`}
      >
        <div className="px-6 pb-6">
          <div className="border-t border-gray-100 pt-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Image */}
              <div className="flex items-center justify-center order-1 lg:order-2">
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-2xl blur-xl" />
                  <img
                    src={phase.image}
                    alt={`${phase.phase} Safety`}
                    className="relative rounded-2xl shadow-lg max-h-48 object-contain bg-white"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                </div>
              </div>

              {/* Do's */}
              <div className="order-2 lg:order-1">
                <div className="h-full bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-sm">
                      ✅
                    </div>
                    <h3 className="font-bold text-emerald-800">Do's</h3>
                  </div>
                  <ul className="space-y-3">
                    {phase.dos.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-emerald-900">
                        <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center text-xs text-emerald-600 shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Don'ts */}
              <div className="order-3">
                <div className="h-full bg-gradient-to-br from-red-50 to-orange-50 border border-red-200 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-sm">
                      ❌
                    </div>
                    <h3 className="font-bold text-red-800">Don'ts</h3>
                  </div>
                  <ul className="space-y-3">
                    {phase.donts.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-red-900">
                        <span className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center text-xs text-red-600 shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DosAndDonts() {
  const [expandedPhase, setExpandedPhase] = useState(null);

  const togglePhase = (index) => {
    setExpandedPhase(expandedPhase === index ? null : index);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Page Header */}
      <div className="text-center animate-fade-in-up">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-red-600 text-3xl mb-4 shadow-lg">
          📖
        </div>
        <h1 className="text-3xl font-bold text-gray-900">Earthquake Safety Guide</h1>
        <p className="text-gray-500 mt-2 max-w-2xl mx-auto">
          Essential do's and don'ts to stay safe before, during, and after an earthquake. 
          Click on each phase to learn more.
        </p>
      </div>

      {/* Quick Tips Banner */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-6 animate-fade-in-up">
        <div className="flex items-start gap-4">
          <div className="text-3xl shrink-0">💡</div>
          <div>
            <h3 className="font-bold text-amber-900 mb-2">Quick Safety Tips</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="flex items-center gap-2 text-amber-800">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span>Prepare an emergency kit</span>
              </div>
              <div className="flex items-center gap-2 text-amber-800">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span>Know evacuation routes</span>
              </div>
              <div className="flex items-center gap-2 text-amber-800">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span>Stay informed via alerts</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Phase Cards */}
      <div className="space-y-4">
        {earthquakeData.map((phase, index) => (
          <div key={index} className="animate-fade-in-up" style={{ animationDelay: `${index * 0.15}s` }}>
            <PhaseCard
              phase={phase}
              index={index}
              isExpanded={expandedPhase === index}
              onToggle={() => togglePhase(index)}
            />
          </div>
        ))}
      </div>

      {/* Emergency Contacts Footer */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-8 text-center animate-fade-in-up">
        <div className="text-4xl mb-4">🆘</div>
        <h3 className="text-xl font-bold text-white mb-2">Emergency Contacts</h3>
        <p className="text-gray-400 mb-6">Keep these numbers handy in case of emergencies</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
          <div className="bg-white/10 rounded-xl p-4">
            <div className="text-2xl font-bold text-red-400">100</div>
            <div className="text-sm text-gray-400">Police</div>
          </div>
          <div className="bg-white/10 rounded-xl p-4">
            <div className="text-2xl font-bold text-red-400">101</div>
            <div className="text-sm text-gray-400">Fire Brigade</div>
          </div>
          <div className="bg-white/10 rounded-xl p-4">
            <div className="text-2xl font-bold text-red-400">108</div>
            <div className="text-sm text-gray-400">Emergency Services</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DosAndDonts;