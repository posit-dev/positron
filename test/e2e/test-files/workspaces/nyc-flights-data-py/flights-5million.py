import pandas as pd
import os

# Read the original file
data_file_path = os.path.join(os.getcwd(), 'data-files', 'flights', 'flights.parquet')
df = pd.read_parquet(data_file_path, engine='pyarrow')

# Repeat the DataFrame 15 times ~ 5 million rows
df_5mil = pd.concat([df] * 15, ignore_index=True)

# Verify the size
print(f"Number of rows in the expanded DataFrame: {len(df_5mil)}")