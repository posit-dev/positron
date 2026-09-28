# slow.py: builds DataFrames whose values hash slowly, standing in for a
# large or remote table. Frequency tables (value_counts) get slow; counts don't.
import time
import pandas as pd

class Slow(str):
    delay = 0.002
    def __hash__(self):
        time.sleep(Slow.delay)
        return str.__hash__(self)

def make_slow(ncols=20, nrows=1000, delay=0.002):
    Slow.delay = delay
    data = {f"s{i:02d}": [Slow(f"v{j % 50}") for j in range(nrows)] for i in range(ncols)}
    return pd.DataFrame(data)
