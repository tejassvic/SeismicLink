import joblib
import numpy as np
import pandas as pd

# Load model and label encoders
model = joblib.load("urgency_model.pkl")
label_encoders = joblib.load("label_encoders.pkl")

# Define feature columns (same as during training)
FEATURE_COLUMNS = [
    "magnitude", "depth_km", "distance_km",
    "category", "amenity_type",
    "inside_strong_radius", "inside_empirical_radius", "inside_max_radius"
]

# --- Preprocessing helper ---
def preprocess(record):
    category_enc = label_encoders['category'].transform([record['category']])[0]
    amenity_enc = label_encoders['amenity_type'].transform([record['amenity_type']])[0]

    return [
        record['magnitude'],
        record['depth_km'],
        record['distance_km'],
        category_enc,
        amenity_enc,
        record['inside_strong_radius'],
        record['inside_empirical_radius'],
        record['inside_max_radius']
    ]

# --- Predict single record ---
def predict_single(input_dict):
    row = preprocess(input_dict)
    df = pd.DataFrame([row], columns=FEATURE_COLUMNS)
    pred = model.predict(df)[0]
    return label_encoders['urgency_level'].inverse_transform([pred])[0]

# --- Predict multiple records ---
def predict_bulk(dict_list):
    rows = [preprocess(record) for record in dict_list]
    df = pd.DataFrame(rows, columns=FEATURE_COLUMNS)
    preds = model.predict(df)
    return label_encoders['urgency_level'].inverse_transform(preds).tolist()


sample_input = {
    "magnitude": 6.5,
    "depth_km": 45.0,
    "distance_km": 10.0,
    "category": "school",
    "amenity_type": "college",
    "inside_strong_radius": 1,
    "inside_empirical_radius": 1,
    "inside_max_radius": 0
}

print("Predicted Urgency:", predict_single(sample_input))