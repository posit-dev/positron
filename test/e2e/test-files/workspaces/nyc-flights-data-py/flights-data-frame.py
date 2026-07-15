import pandas as pd
import os
data_file_path = os.path.join(os.getcwd(), 'data-files', 'flights', 'flights.parquet')
df = pd.read_parquet(data_file_path, engine='pyarrow')
print(len(df))