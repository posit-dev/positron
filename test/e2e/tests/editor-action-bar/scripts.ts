/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Script to load a CSV file using Python Pandas.
 * Reads a CSV file located in the `data-files/spotify_data` directory
 * and loads it into a Pandas DataFrame.
 */
export const pandasDataFrame = `import pandas as pd
import numpy as np

# Create the DataFrame
df = pd.DataFrame({
    'Training': ['Strength', 'Stamina', 'Other'],
    'Pulse': [100, np.nan, 120],  # Use np.nan for missing values
    'Duration': [60, 30, 45],
    'Note': [np.nan, np.nan, 'Note']  # Use np.nan for missing values
})

# Display the DataFrame
print(df)`;

/**
 * Script to create a sample data frame in R.
 */
export const rDataFrame = `df <- data.frame (
	Training = c("Strength", "Stamina", "Other"),
	Pulse = c(100, NA, 120),
	Duration = c(60, 30, 45),
	Note = c(NA, NA, "Note")
)`;
