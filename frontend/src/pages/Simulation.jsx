import React, { useState, useEffect } from 'react'
import { API_BASE_URL } from '../config'

const STEPS = ['Event Details', 'Affected Area', 'Alert Configuration', 'Review & Dispatch']

const TARGET_SERVICES = [
  { value: 'Police', label: 'Police', icon: '👮' },
  { value: 'Fire Department', label: 'Fire Department', icon: '🔥' },
  { value: 'Hospitals', label: 'Hospitals', icon: '🏥' },
  { value: 'Emergency Medical Services', label: 'Emergency Medical Services', icon: '🚑' },
  { value: 'Public Broadcast', label: 'Public Broadcast', icon: '📢' },
]

const SEVERITY_OPTIONS = [
  { value: 'Extreme', label: 'Extreme', color: 'bg-red-500', description: 'Extraordinary threat to life and property' },
  { value: 'Severe', label: 'Severe', color: 'bg-orange-500', description: 'Significant threat to life and property' },
  { value: 'Moderate', label: 'Moderate', color: 'bg-amber-500', description: 'Possible threat to life and property' },
  { value: 'Minor', label: 'Minor', color: 'bg-yellow-500', description: 'Minimal or no threat to life and property' },
  { value: 'Unknown', label: 'Unknown', color: 'bg-gray-400', description: 'Severity unknown' },
]

const URGENCY_OPTIONS = [
  { value: 'Immediate', label: 'Immediate', color: 'bg-red-500', description: 'Responsive action should be taken immediately' },
  { value: 'Expected', label: 'Expected', color: 'bg-orange-500', description: 'Responsive action should be taken soon' },
  { value: 'Future', label: 'Future', color: 'bg-amber-500', description: 'Responsive action should be taken in the future' },
  { value: 'Past', label: 'Past', color: 'bg-gray-400', description: 'Event has already occurred' },
  { value: 'Unknown', label: 'Unknown', color: 'bg-gray-400', description: 'Urgency unknown' },
]

function Simulation() {
  const [currentStep, setCurrentStep] = useState(0);
  const [events, setEvents] = useState([]);
  const [formData, setFormData] = useState({
    eventId: '',
    areaDescription: '',
    targetServices: '',
    severity: '',
    urgency: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [simulationResult, setSimulationResult] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Fetch available events for dropdown
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/earthquake-events?page=1&page_size=100`);
        const data = await res.json();
        setEvents(data.events || []);
      } catch {}
    };
    fetchEvents();
  }, []);

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0: return formData.eventId.trim().length > 0;
      case 1: return formData.areaDescription.trim().length > 0;
      case 2: return formData.targetServices && formData.severity && formData.urgency;
      case 3: return true;
      default: return false;
    }
  };

  const handleNext = () => {
    if (canProceed() && currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    setSuccess('');
    setSimulationResult(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/send-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: formData.eventId,
          area_description: formData.areaDescription,
          target_services: formData.targetServices,
          severity: formData.severity,
          urgency: formData.urgency,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      setSuccess('Alert dispatched successfully!');
      const data = await response.json();
      setSimulationResult(data);
    } catch (err) {
      setError(`Failed to run simulation: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({ eventId: '', areaDescription: '', targetServices: '', severity: '', urgency: '' });
    setCurrentStep(0);
    setSimulationResult(null);
    setError('');
    setSuccess('');
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Page Header */}
      <div className="animate-fade-in-up">
        <h1 className="text-3xl font-bold text-gray-900">CAP Notification Simulation</h1>
        <p className="text-gray-500 mt-1">Simulate Common Alerting Protocol dispatch for emergency services</p>
      </div>

      {/* Steps Indicator */}
      <div className="animate-fade-in-up">
        <div className="flex items-center justify-between">
          {STEPS.map((step, index) => (
            <div key={index} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                  index <= currentStep
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-200 text-gray-400'
                }`}>
                  {index < currentStep ? '✓' : index + 1}
                </div>
                <span className={`text-xs mt-1.5 font-medium ${
                  index <= currentStep ? 'text-blue-600' : 'text-gray-400'
                }`}>
                  {step}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 mt-[-1.5rem] transition-all duration-300 ${
                  index < currentStep ? 'bg-blue-600' : 'bg-gray-200'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Form Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-scale-in">
        <div className="p-8">
          <form onSubmit={handleSubmit}>
            {/* Step 1: Event Details */}
            {currentStep === 0 && (
              <div className="space-y-6 animate-fade-in-up">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Event Details</h2>
                  <p className="text-sm text-gray-500 mt-1">Enter the seismic event identifier</p>
                </div>
                <div>
                  <label className="form-label">Event ID</label>
                  <select
                    value={formData.eventId}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateField('eventId', val);
                      // Auto-fill area description from event name
                      const event = events.find(ev => ev.event_id === val);
                      if (event) {
                        updateField('areaDescription', `${event.event_name} - Impact Zone`);
                      }
                    }}
                    className="form-select"
                  >
                    <option value="">Select an event...</option>
                    {events.map(event => (
                      <option key={event.event_id} value={event.event_id}>
                        {event.event_name} (M{event.magnitude})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1.5">Choose from existing seismic events or type manually</p>
                </div>
              </div>
            )}

            {/* Step 2: Affected Area */}
            {currentStep === 1 && (
              <div className="space-y-6 animate-fade-in-up">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Affected Area</h2>
                  <p className="text-sm text-gray-500 mt-1">Describe the region impacted by the event</p>
                </div>
                <div>
                  <label className="form-label">Area Description</label>
                  <textarea
                    value={formData.areaDescription}
                    onChange={(e) => updateField('areaDescription', e.target.value)}
                    rows={4}
                    className="form-input resize-none"
                    placeholder="e.g., Northern region of Delhi NCR, including Ghaziabad and Noida"
                  />
                </div>
              </div>
            )}

            {/* Step 3: Alert Configuration */}
            {currentStep === 2 && (
              <div className="space-y-8 animate-fade-in-up">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Alert Configuration</h2>
                  <p className="text-sm text-gray-500 mt-1">Configure the alert parameters</p>
                </div>

                {/* Target Services */}
                <div>
                  <label className="form-label">Target Service</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {TARGET_SERVICES.map((service) => (
                      <button
                        key={service.value}
                        type="button"
                        onClick={() => updateField('targetServices', service.value)}
                        className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all duration-200 ${
                          formData.targetServices === service.value
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300 bg-white'
                        }`}
                      >
                        <span className="text-2xl">{service.icon}</span>
                        <div className="text-left">
                          <div className="text-sm font-medium text-gray-900">{service.label}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Severity */}
                <div>
                  <label className="form-label">Severity</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {SEVERITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => updateField('severity', opt.value)}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-200 ${
                          formData.severity === opt.value
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span className={`w-3 h-3 rounded-full ${opt.color}`} />
                        <div className="text-left">
                          <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                          <div className="text-xs text-gray-500">{opt.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Urgency */}
                <div>
                  <label className="form-label">Urgency</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {URGENCY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => updateField('urgency', opt.value)}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-200 ${
                          formData.urgency === opt.value
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span className={`w-3 h-3 rounded-full ${opt.color}`} />
                        <div className="text-left">
                          <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                          <div className="text-xs text-gray-500">{opt.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Review & Dispatch */}
            {currentStep === 3 && (
              <div className="space-y-6 animate-fade-in-up">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Review & Dispatch</h2>
                  <p className="text-sm text-gray-500 mt-1">Review the alert details before dispatching</p>
                </div>

                {/* Alert Preview Card */}
                <div className="bg-gradient-to-br from-red-50 to-orange-50 border border-red-200 rounded-xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-xl">
                      🚨
                    </div>
                    <div>
                      <h3 className="font-bold text-red-900">CAP Alert Preview</h3>
                      <p className="text-xs text-red-700">Common Alerting Protocol</p>
                    </div>
                  </div>
                  
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between py-2 border-b border-red-200">
                      <span className="text-red-700 font-medium">Event ID</span>
                      <span className="text-red-900 font-mono">{formData.eventId}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-red-200">
                      <span className="text-red-700 font-medium">Affected Area</span>
                      <span className="text-red-900 text-right max-w-[200px]">{formData.areaDescription}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-red-200">
                      <span className="text-red-700 font-medium">Target Service</span>
                      <span className="text-red-900">{formData.targetServices}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-red-200">
                      <span className="text-red-700 font-medium">Severity</span>
                      <span className="text-red-900">{formData.severity}</span>
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="text-red-700 font-medium">Urgency</span>
                      <span className="text-red-900">{formData.urgency}</span>
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-primary w-full py-3 text-base"
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Dispatching Alert...
                    </span>
                  ) : (
                    '🚨 Dispatch Alert'
                  )}
                </button>
              </div>
            )}

            {/* Navigation Buttons */}
            {currentStep < 3 && (
              <div className="flex justify-between mt-8 pt-6 border-t border-gray-100">
                <button
                  type="button"
                  onClick={handlePrev}
                  className={`btn-secondary ${currentStep === 0 ? 'invisible' : ''}`}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={!canProceed()}
                  className="btn-primary"
                >
                  Continue →
                </button>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 animate-fade-in-up">
          <span className="text-xl">❌</span>
          <div>
            <p className="text-sm font-medium text-red-800">Dispatch Failed</p>
            <p className="text-sm text-red-600">{error}</p>
          </div>
        </div>
      )}

      {/* Success Display */}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 animate-scale-in">
          <div className="text-center">
            <div className="text-5xl mb-4">✅</div>
            <h3 className="text-xl font-bold text-emerald-800 mb-2">Alert Dispatched Successfully</h3>
            <p className="text-emerald-600 mb-4">{success}</p>
            {simulationResult && (
              <div className="bg-white rounded-lg p-4 text-left text-sm font-mono text-gray-700 mb-4">
                <pre className="whitespace-pre-wrap">{JSON.stringify(simulationResult, null, 2)}</pre>
              </div>
            )}
            <button onClick={resetForm} className="btn-primary">
              Dispatch Another Alert
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Simulation