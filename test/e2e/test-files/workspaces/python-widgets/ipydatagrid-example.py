# works in console


import pandas as pd
from ipydatagrid import DataGrid
data= pd.DataFrame({"A": [1, 2, 3], "B": [4, 5, 6]}, index=["One", "Two", "Three"])
DataGrid(data)
DataGrid(data, selection_mode="cell", editable=True)