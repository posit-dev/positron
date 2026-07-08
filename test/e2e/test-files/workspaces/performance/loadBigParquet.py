import pandas as pd
import os
data_file_path = os.path.join(os.getcwd(), 'data-files', 'largeParquet.parquet')
df = pd.read_parquet(data_file_path, engine='pyarrow')
