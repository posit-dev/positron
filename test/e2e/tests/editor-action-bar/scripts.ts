/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Script to load a Parquet file using Python Pandas.
 * Reads a Parquet file located in the `data-files/100x100` directory
 * and loads it into a Pandas DataFrame.
 */
export const pandasParquetScript = `import pandas as pd
import os

file_path = os.path.join(os.getcwd(), 'data-files', '100x100', '100x100.parquet')

# Read the Parquet file into a pandas DataFrame
df = pd.read_parquet(file_path)

# Display the DataFrame
print(df)`;

/**
 * Script to load a CSV file using Python Pandas.
 * Reads a CSV file located in the `data-files/spotify_data` directory
 * and loads it into a Pandas DataFrame.
 */
export const pandasCsvScript = `import pandas as pd
import os

file_path = os.path.join(os.getcwd(), 'data-files', 'spotify_data', 'data.csv')

# Read the CSV file into a pandas DataFrame
df = pd.read_csv(file_path)

# Display the DataFrame
print(df)`;

/**
 * Script to load a TSV file using Python Polars.
 * Reads a TSV file located in the `data-files/100x100` directory,
 * converts it from a Pandas DataFrame to a Polars DataFrame,
 * and displays the resulting data.
 */
export const polarsTsvScript = `import pandas as pd
import polars as pl
import os

file_path = os.path.join(os.getcwd(), 'data-files', '100x100', 'polars-100x100.tsv')

pandas_dataframe = pd.read_csv(file_path, delimiter='\\t')

# Convert to Polars DataFrame
df = pl.from_pandas(pandas_dataframe)

# Display the DataFrame
print(df)`;

/**
 * Script to create a sample data frame in R.
 */
export const rScript = `df <- data.frame (
	Training = c("Strength", "Stamina", "Other"),
	Pulse = c(100, NA, 120),
	Duration = c(60, 30, 45),
	Note = c(NA, NA, "Note")
)`;
