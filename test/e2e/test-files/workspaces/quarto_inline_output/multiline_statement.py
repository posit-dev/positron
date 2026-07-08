# This is a multi-line statement in Python.
sum(
    v ** 0.5
    for v in [1, 2, 3]
)

# And here is another.
([1, 2, 3] +
    [4, 5, 6] +
    [7, 8, 9])

# And one more for good measure.
import pandas as pd
(pd.DataFrame(
    {"x": [1, 2, 3],
     "y": [4, 5, 6]})
    .query("x > 1")
    .assign(z=lambda d: d.x + d.y)
    .head())
