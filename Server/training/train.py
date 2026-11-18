import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
import matplotlib.pyplot as plt
import seaborn as sns
import joblib

# Load the dataset
df = pd.read_csv("./complex_synthetic_urgency.csv")

# Encode categorical features
label_encoders = {}
for col in ['category', 'amenity_type', 'urgency_level']:
    le = LabelEncoder()
    df[col] = le.fit_transform(df[col])
    label_encoders[col] = le

# Features and target
X = df.drop(columns=['urgency_score', 'urgency_level'])  # Drop score & label
y = df['urgency_level']  # Target: urgency level

# Split into train-test
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# Train Random Forest
clf = RandomForestClassifier(n_estimators=100, random_state=42)
clf.fit(X_train, y_train)

# Predict
y_pred = clf.predict(X_test)

# Evaluation
print("📊 Classification Report:")
print(classification_report(y_test, y_pred, target_names=label_encoders['urgency_level'].classes_))

print(f"✅ Accuracy: {accuracy_score(y_test, y_pred):.2f}")

# Export the model
joblib.dump(clf, "./urgency_model.pkl")
print("✅ Model saved to 'urgency_model.pkl'")
joblib.dump(label_encoders, "./label_encoders.pkl")
print("✅ Label encoders saved")

# Confusion Matrix
cm = confusion_matrix(y_test, y_pred)
sns.heatmap(cm, annot=True, fmt="d", xticklabels=label_encoders['urgency_level'].classes_, yticklabels=label_encoders['urgency_level'].classes_)
plt.xlabel("Predicted")
plt.ylabel("Actual")
plt.title("Confusion Matrix")
plt.tight_layout()
plt.show()
