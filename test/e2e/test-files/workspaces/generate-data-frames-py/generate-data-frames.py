import pandas as pd
import numpy as np
import os

# seems like a reasonable upper limit on an m3 with 36Gb
num_rows = 80000
num_cols = 80000

data = {}
for i in range(num_cols):
    col_name = f'col{i+1}'
    data[col_name] = np.random.randint(low=0, high=100, size=num_rows)

df = pd.DataFrame(data)

# don't add to github:
filePath = os.path.join(os.getcwd(), 'data-files', '80kX80k.parquet')
df.to_parquet(filePath)