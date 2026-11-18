"""Transparent first-pass waveform metrics. Not a trained seismic ML model."""
from __future__ import annotations
import math

def analyze_samples(samples: list[dict]) -> dict:
    if not samples:
        return {'sample_count': 0, 'model_status': 'not_trained'}
    axes = [[float(s.get(axis, 0) or 0) for s in samples] for axis in ('x_g','y_g','z_g')]
    means = [sum(axis)/len(axis) for axis in axes]
    mags = [math.sqrt(sum((axes[a][i]-means[a])**2 for a in range(3))) for i in range(len(samples))]
    rms = math.sqrt(sum(v*v for v in mags) / len(mags))
    peak = max(mags)
    return {
        'sample_count': len(samples),
        'sampling_rate_hz': 100,
        'vector_rms_g': round(rms, 6),
        'peak_vector_g': round(peak, 6),
        'peak_sample_index': int(samples[mags.index(peak)].get('sample_index', 0)),
        'processing': 'axis_demeaned_rms_peak_baseline',
        'wave_classification': 'pending_labeled_dataset',
        'p_wave_pick': None,
        's_wave_pick': None,
        'model_status': 'not_trained',
        'disclaimer': 'Baseline signal metrics only; no validated P/S classifier is active.'
    }
