#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import datetime
import math
import sys

import numpy as np
import pandas as pd

BOOL_CASES = [True, False]


STRING_CASES = [
    "",  # Empty String
    "Hello, world!",  # Basic String
    "    ",  # Whitespace String
    "First\nSecond\nThird",  # Multiline String
    "This has a Windows linebreak\r\n",  # Windows Linebreak
    " Space Before\tTab Between\tSpace After ",  # Trailing Whitespace
    "É una bella città",  # Accented String
    "こんにちは",  # Japanese String
    "עֶמֶק",  # RTL String
    "ʇxǝʇ",  # Upsidedown String
    "😅😁",  # Emoji String
]


# Python 3 ints are unbounded, but we include a few large numbers
# for basic test cases
INT_CASES = [
    -sys.maxsize * 100,
    -sys.maxsize,
    -1,
    0,
    1,
    sys.maxsize,
    sys.maxsize * 100,
]


NUMPY_SCALAR_CASES = [
    np.int8(1),
    np.int16(1),
    np.int32(1),
    np.int64(1),
    np.float16(1.0),
    np.float32(1.0),
    np.float64(1.0),
]


FLOAT_CASES = [
    float("-inf"),
    -sys.float_info.max,
    -1.0,
    -sys.float_info.min,
    float("nan"),
    0.0,
    sys.float_info.min,
    1.0,
    math.pi,
    sys.float_info.max,
    float("inf"),
]


COMPLEX_CASES = [
    complex(-1.0, 100.1),
    complex(-1.0, 0.0),
    complex(0, 0),
    complex(1.0, 0.0),
    complex(1.0, 100.1),
]


CLASSES_CASES = [pd.DataFrame, np.ndarray, datetime.tzinfo, bytes, str]


BYTES_CASES = [b"", b"\x00", b"caff\\xe8"]


RANGE_CASES = [
    range(0),  # Empty Range
    range(1),  # Range with positive start, 1 element
    range(-1, 0),  # Range with negative start, 1 element
    range(-2, 3),  # Range with negative start, positive stop
    range(10, 21, 2),  # Range with positive start, positive stop, and positive step
    range(20, 9, -2),  # Range with positive start, positive stop, and negative step
    range(2, -10, -2),  # Range with positive start, negative stop, and negative step
    range(-20, -9, 2),  # Range with negative start, negative stop, and positive step
    range(-10, 3, 2),  # Range with negative start, positive stop, and positive step
    range(1, 5000),  # Large Range (compact display, does not show elements)
]


TIMESTAMP_CASES = [
    pd.Timestamp("2021-01-01 01:23:45"),
    datetime.datetime(2021, 1, 1, 1, 23, 45),
]
