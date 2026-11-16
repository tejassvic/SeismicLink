import random
import csv
import os, math

# --- Configuration ---
NUM_EVENTS = 20
INFRA_PER_EVENT = 50

# Infrastructure criticality scores
infra_scores = {
    'hospital': 2.0,
    'school': 1.0,
    'government': 1.5,
    'transport': 1.8,
    'utilities': 1.2,
    'emergency': 1.9
}

# Amenity mapping
infra_map = {
    'hospital':    ['hospital', 'clinic', 'emergency_ward'],
    'school':      ['school', 'university', 'college'],
    'government':  ['government', 'police', 'fire_station'],
    'transport':   ['airport', 'railway_station', 'bus_station'],
    'utilities':   ['power_station', 'water_treatment', 'gas_station'],
    'emergency':   ['emergency_phone', 'shelter', 'refuge']
}

# Amenity → category reverse mapping
amenity_to_category = {
    amenity: category
    for category, items in infra_map.items()
    for amenity in items
}
amenities = list(amenity_to_category.keys())

# --- Scoring & Classification Functions ---

def compute_zone_bonus(distance, strong_r, empirical_r, max_r):
    """
    Assigns zone tier bonus. Strong zone yields highest urgency influence.
    """
    if distance < strong_r:
        return 3.0
    elif distance < empirical_r:
        return 2.0
    elif distance < max_r:
        return 1.0
    else:
        return 0.0

def compute_urgency_score(magnitude, depth_km, category_score, zone_bonus):
    """
    Computes urgency score based on zone, magnitude, depth, and category.
    Distance is excluded except via zone tier.
    """
    return (
        (1.5 * zone_bonus) +      # proximity tier
        (1.2 * magnitude) +       # seismic strength
        category_score -          # infra criticality
        (0.01 * depth_km)         # deeper = less surface damage
    )

def classify(score):
    """Converts continuous urgency score to a discrete level."""
    if score >= 15:
        return "High"
    elif score >= 10:
        return "Medium"
    else:
        return "Low"

# --- Generate Synthetic Dataset ---

data = []

for _ in range(NUM_EVENTS):
    magnitude = round(random.uniform(4.5, 9.0), 1)
    depth_km = round(random.uniform(5, 300), 1)

    # Define seismic impact radii
    # strong_r = round(random.uniform(20, 50), 1)
    # empirical_r = round(strong_r + random.uniform(10, 50), 1)
    # max_r = round(empirical_r + random.uniform(10, 100), 1)

    empirical_radius_raw = 10 ** (0.43 * magnitude - 1.55)
    strong_radius_raw = 10 ** ((magnitude - 5) / 2)
    max_radius_raw = 10 ** (magnitude - 3)
    
    # Apply depth correction
    depth_correction = math.sqrt(70 / (depth_km + 10))
    
    # Calculate adjusted radii
    empirical_radius_adj = empirical_radius_raw * depth_correction
    strong_radius_adj = strong_radius_raw * depth_correction
    max_radius_adj = max_radius_raw * depth_correction

    strong_radius = strong_radius_adj
    empirical_radius = empirical_radius_adj  
    max_radius = max_radius_adj

    for _ in range(INFRA_PER_EVENT):
        amenity = random.choice(amenities)
        category = amenity_to_category[amenity]
        cat_score = infra_scores[category]

        distance_km = round(random.uniform(1, max_radius + 50), 1)

        # Zone flags
        inside_strong = distance_km < strong_radius
        inside_empirical = strong_radius <= distance_km < empirical_radius
        inside_max = empirical_radius <= distance_km < max_radius

        zone_bonus = compute_zone_bonus(distance_km, strong_radius, empirical_radius, max_radius)
        urgency_score = compute_urgency_score(magnitude, depth_km, cat_score, zone_bonus)
        urgency_label = classify(urgency_score)

        data.append([
            magnitude, depth_km, distance_km,
            category, amenity,
            int(inside_strong), int(inside_empirical), int(inside_max),
            round(urgency_score, 2), urgency_label
        ])

# --- Export to CSV ---

output_path = os.path.expanduser("./complex_synthetic_urgency.csv")

with open(output_path, "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow([
        "magnitude", "depth_km", "distance_km",
        "category", "amenity_type",
        "inside_strong_radius", "inside_empirical_radius", "inside_max_radius",
        "urgency_score", "urgency_level"
    ])
    writer.writerows(data)

print(f"✅ Saved {len(data)} records to: {output_path}")