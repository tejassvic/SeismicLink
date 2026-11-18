import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

# Load the data
df = pd.read_csv("./complex_synthetic_urgency.csv")

# Set up the plot style
sns.set_style("whitegrid")
plt.rcParams['figure.dpi'] = 100

# 1. Distribution of Urgency Levels
plt.figure(figsize=(8, 6))
sns.countplot(x='urgency_level', data=df, order=['Low', 'Medium', 'High'])
plt.title('Distribution of Urgency Levels')
plt.xlabel('Urgency Level')
plt.ylabel('Count')
plt.show()

# 2. Urgency Score vs. Magnitude
plt.figure(figsize=(10, 6))
sns.scatterplot(x='magnitude', y='urgency_score', hue='urgency_level', data=df)
plt.title('Urgency Score vs. Magnitude')
plt.xlabel('Magnitude')
plt.ylabel('Urgency Score')
plt.legend(title='Urgency Level')
plt.show()

# 3. Urgency Score vs. Distance
plt.figure(figsize=(10, 6))
sns.scatterplot(x='distance_km', y='urgency_score', hue='urgency_level', data=df)
plt.title('Urgency Score vs. Distance from Epicenter')
plt.xlabel('Distance from Epicenter (km)')
plt.ylabel('Urgency Score')
plt.legend(title='Urgency Level')
plt.show()

# 4. Impact of Infrastructure Category on Urgency Score
plt.figure(figsize=(12, 7))
sns.boxplot(x='category', y='urgency_score', data=df)
plt.title('Urgency Score by Infrastructure Category')
plt.xlabel('Infrastructure Category')
plt.ylabel('Urgency Score')
plt.xticks(rotation=45)
plt.show()

# 5. Urgency Level by Radius Zone
# Create a new column for the zone
def get_zone(row):
    if row['inside_strong_radius'] == 1:
        return 'Strong'
    elif row['inside_empirical_radius'] == 1:
        return 'Empirical'
    elif row['inside_max_radius'] == 1:
        return 'Max'
    else:
        return 'Outside'

df['zone'] = df.apply(get_zone, axis=1)
plt.figure(figsize=(10, 6))
sns.countplot(x='zone', hue='urgency_level', data=df, order=['Strong', 'Empirical', 'Max', 'Outside'])
plt.title('Urgency Level Distribution by Radius Zone')
plt.xlabel('Seismic Zone')
plt.ylabel('Count')
plt.legend(title='Urgency Level')
plt.show()