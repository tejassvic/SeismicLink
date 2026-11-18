from seismo.analysis import analyze_samples

def test_analysis_removes_static_axis_offset_and_reports_peak():
    samples=[]
    for i in range(100):
        v=0.01 if i==55 else 0.0
        samples.append({'sample_index':i,'x_g':v,'y_g':0.0,'z_g':0.98})
    result=analyze_samples(samples)
    assert result['sample_count']==100
    assert result['peak_sample_index']==55
    assert result['peak_vector_g'] > result['vector_rms_g']
    assert result['model_status']=='not_trained'

def test_empty_analysis_is_safe():
    assert analyze_samples([])['sample_count']==0
