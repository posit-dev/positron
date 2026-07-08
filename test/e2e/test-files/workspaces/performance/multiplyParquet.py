import pandas as pd
import os

data_file_path = os.path.join(os.getcwd(), 'data-files', '20x1000', 'parquet1kx20.parquet')
df = pd.read_parquet(data_file_path, engine='pyarrow')
df_large = pd.concat([df] * 1000, ignore_index=True)