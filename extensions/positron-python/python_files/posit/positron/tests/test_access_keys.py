#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import json
import math
from typing import Any

import numpy as np
import pandas as pd
import polars as pl
import pytest
from fastcore.foundation import L

from positron.access_keys import decode_access_key, encode_access_key

from .data import (
    BOOL_CASES,
    BYTES_CASES,
    COMPLEX_CASES,
    FLOAT_CASES,
    INT_CASES,
    NUMPY_SCALAR_CASES,
    RANGE_CASES,
    STRING_CASES,
    TIMESTAMP_CASES,
)

try:
    import torch
except ImportError:
    torch = None


@pytest.mark.parametrize(
    "case",
    BOOL_CASES
    + STRING_CASES
    + INT_CASES
    + NUMPY_SCALAR_CASES
    + FLOAT_CASES
    + COMPLEX_CASES
    + BYTES_CASES
    + RANGE_CASES
    + TIMESTAMP_CASES,
)
def test_encode_decode_access_key(case: Any) -> None:
    """Test that we can encode and decode to recovery supported data types."""
    access_key = encode_access_key(case)
    result = decode_access_key(access_key)
    # Handle the float('nan') case since nan != nan
    if isinstance(case, float) and math.isnan(case):
        assert math.isnan(result)
    else:
        assert result == case


@pytest.mark.parametrize(
    "case",
    [
        bytearray(),
        [],
        set(),
        L(),
        pd.DataFrame(),
        pd.Series(),
        pl.DataFrame(),
        pl.Series(),
        np.array([]),
    ],
)
def test_encode_access_key_not_hashable_error(case: Any) -> None:
    """Encoding an access key of an unhashable type raises an error."""
    with pytest.raises(TypeError):
        encode_access_key(case)


@pytest.mark.parametrize(
    "case",
    [
        torch.tensor([]) if torch else None,
        lambda x: x,
    ],
)
def test_encode_access_key_not_implemented_error(case: Any) -> None:
    """Encoding an access key of an unsupported type raises an error."""
    access_key = None

    with pytest.raises(NotImplementedError):
        access_key = encode_access_key(case)

    if access_key is not None:
        with pytest.raises(NotImplementedError):
            decode_access_key(access_key)


@pytest.mark.parametrize(
    "type_name",
    [
        "torch.Tensor" if torch else "None",
        "function",
    ],
)
def test_decode_access_key_not_implemented_error(type_name: str) -> None:
    """Decoding an access key of an unsupported type raises an error."""
    access_key = json.dumps({"type": type_name, "data": None})
    with pytest.raises(NotImplementedError):
        decode_access_key(access_key)
