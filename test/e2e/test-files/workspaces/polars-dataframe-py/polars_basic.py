import polars as pl

from datetime import date
df = pl.DataFrame(
    {
        "foo": [1, 2, 3],
        "bar": [6.0, 7.0, 8.0],
        "ham": [date(2020, 1, 2), date(2021, 3, 4), date(2022, 5, 6)],
        "a": [None, 2, 3],
        "b": [0.5, None, 2.5],
        "c": [True, None, False],
    }
)