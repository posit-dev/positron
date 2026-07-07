import pandas as pd
import numpy as np

# Create the DataFrame
df = pd.DataFrame({
    'Training': ['Strength', 'Stamina', 'Other'],
    'Pulse': [100, np.nan, 120],  # Use np.nan for missing values
    'Duration': [60, 30, 45],
    'Note': [np.nan, np.nan, 'Note']  # Use np.nan for missing values
})

# Display the DataFrame
print(df)