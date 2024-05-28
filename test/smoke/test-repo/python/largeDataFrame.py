import pandas as pd
import numpy as np
num_rows = 100000
num_cols = 10

data = {}
for i in range(num_cols):
    col_name = f'col{i+1}'
    data[col_name] = np.random.randint(low=0, high=100, size=num_rows)

df = pd.DataFrame(data)
