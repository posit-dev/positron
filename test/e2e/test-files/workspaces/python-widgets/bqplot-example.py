# works in console


import bqplot.pyplot as bplt
import numpy as np

x = np.linspace(-10, 10, 100)
y = np.sin(x)
axes_opts = {"x": {"label": "X"}, "y": {"label": "Y"}}

fig = bplt.figure(title="Line Chart")
line = bplt.plot(
    x=x, y=y, axes_options=axes_opts
)

bplt.show()
