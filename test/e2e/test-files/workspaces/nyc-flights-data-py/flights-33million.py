import pandas as pd
import os

# Read the original file
data_file_path = os.path.join(os.getcwd(), 'data-files', 'flights', 'flights.parquet')
df = pd.read_parquet(data_file_path, engine='pyarrow')

# Repeat the DataFrame 100 times
df_large = pd.concat([df] * 100, ignore_index=True)

# Verify the size
print(f"Number of rows in the expanded DataFrame: {len(df_large)}")

# Optionally, save the larger DataFrame back to a parquet file
# output_file_path = os.path.join(os.getcwd(), 'data-files', 'flights', 'flights_large.parquet')
# df_large.to_parquet(output_file_path, engine='pyarrow')