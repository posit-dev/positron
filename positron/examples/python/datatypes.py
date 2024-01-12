xBool = True
xBytearray = bytearray(5)
xBytes = b"Hello"
xComplex = 3 + 2j
xDict = {"name" : "John", "age" : 36}
xFloat = 20.5
xFrozenset = frozenset({"apple", "banana", "cherry"})
xInt = 20
xList = ["apple", "banana", "cherry"]
xListInt = list(range(500))
xMemoryview = memoryview(bytes(5))
xRange = range(500)
xSet = {"apple", "banana", "cherry"}
xStr = "Hello World"
xTuple = ("apple", "banana", "cherry")
xListOfDict = [{"id": 1, "name": "One"}, {"id": 2, "name": "Two"}, {"id": 3, "name": "Three"},
               {"id": 4, "name": "Four"}, {"id": 5, "name": "Five"}, {"id": 6, "name": "Six"}]
xNone = None

def multiply(a:int = 0, b:int = 0) -> int:
    """Multiplies two integers"""
    return a * b

def simple():
    return 'simple'

data = {'Name':['One', 'Two', 'Three', 'Four', 'Five'],'Numbers':[1,2,3,4,5]}

import pandas as pd
df = pd.DataFrame(data)

import polars
polar_df = polars.DataFrame(data)

rtl = 'עֶמֶק'
