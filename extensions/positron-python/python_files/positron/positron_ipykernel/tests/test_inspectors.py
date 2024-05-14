#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#
import copy
import datetime
import inspect
import pprint
import random
import string
import types
from typing import Any, Callable, Iterable, Optional, Tuple

import numpy as np
import pandas as pd
import polars as pl
import pytest
from fastcore.foundation import L

from positron_ipykernel.inspectors import PRINT_WIDTH, TRUNCATE_AT, get_inspector
from positron_ipykernel.utils import get_qualname
from positron_ipykernel.variables_comm import VariableKind

from .data import (
    BOOL_CASES,
    BYTES_CASES,
    CLASSES_CASES,
    COMPLEX_CASES,
    FLOAT_CASES,
    INT_CASES,
    NUMPY_SCALAR_CASES,
    RANGE_CASES,
    STRING_CASES,
    TIMESTAMP_CASES,
)
from .utils import get_type_as_str

try:
    import torch  # type: ignore [reportMissingImports] for 3.12
except ImportError:
    torch = None


def verify_inspector(
    value: Any,
    length: int,
    display_value: str,
    is_truncated: bool,
    kind: str,
    display_type: str,
    type_info: str,
    has_children: bool = False,
    has_viewer: bool = False,
    check_deepcopy: bool = True,
    supports_deepcopy: bool = True,
    mutable: bool = False,
    mutate: Optional[Callable[[Any], None]] = None,
) -> None:
    # NOTE: Skip `get_size` for now, since it depends on platform, Python version, and package version.

    inspector = get_inspector(value)

    assert inspector.get_length() == length
    assert inspector.has_children() == has_children
    assert inspector.has_viewer() == has_viewer
    assert inspector.get_display_value() == (display_value, is_truncated)
    assert inspector.get_kind() == kind
    assert inspector.get_display_type() == display_type
    assert inspector.get_type_info() == type_info

    if check_deepcopy:
        if supports_deepcopy:
            copied = inspector.deepcopy()

            if mutable:
                # Check that the value is the same.
                assert inspector.equals(copied)

                # Mutate the copied object, and check that the original object was not mutated.
                assert (
                    mutate is not None
                ), "mutate function must be provided to test mutable objects"
                mutate(copied)
                assert not inspector.equals(copied)
            else:
                # Deepcopying an immutable object should return the exact same object.

                # Handle an edge case where a bound method object returns a new object not equal to
                # the original but wrapping the same underlying function.
                if isinstance(value, types.MethodType):
                    assert copied.__func__ is value.__func__
                else:
                    assert copied is value
        else:
            with pytest.raises(copy.Error):
                inspector.deepcopy()


class HelperClass:
    """
    A helper class for testing method functions.
    """

    def __init__(self):
        self._x = 1

    def fn_no_args(self):
        return "No args"

    def fn_one_arg(self, x: str) -> str:
        return f"One arg {x}"

    def fn_two_args(self, x: int, y: int) -> Tuple[int, int]:
        return (x, y)

    @property
    def prop(self):
        return self._x


#
# Test Booleans
#


@pytest.mark.parametrize("value", BOOL_CASES)
def test_inspect_boolean(value: bool) -> None:
    verify_inspector(
        value=value,
        length=0,
        is_truncated=False,
        display_value=str(value),
        kind="boolean",
        display_type="bool",
        type_info="bool",
    )


#
# Test Strings
#


@pytest.mark.parametrize("value", STRING_CASES)
def test_inspect_string(value: str) -> None:
    length = len(value)
    verify_inspector(
        value=value,
        is_truncated=False,
        display_value=repr(value),
        kind=VariableKind.String,
        display_type="str",
        type_info="str",
        length=length,
    )


def test_inspect_string_truncated() -> None:
    value = "".join(random.choices(string.ascii_letters, k=(TRUNCATE_AT + 10)))
    length = len(value)
    verify_inspector(
        value=value,
        display_value=f"'{value[:TRUNCATE_AT]}'",
        kind=VariableKind.String,
        display_type="str",
        type_info="str",
        length=length,
        is_truncated=True,
    )


#
# Test Numbers
#


@pytest.mark.parametrize("value", INT_CASES)
def test_inspect_integer(value: int) -> None:
    verify_inspector(
        value=value,
        length=0,
        is_truncated=False,
        display_value=str(value),
        kind=VariableKind.Number,
        display_type="int",
        type_info="int",
    )


@pytest.mark.parametrize("value", NUMPY_SCALAR_CASES)
def test_inspect_numpy_scalars(value: np.integer) -> None:
    dtype = str(value.dtype)
    verify_inspector(
        value=value,
        length=0,
        is_truncated=False,
        display_value=str(value),
        kind=VariableKind.Number,
        display_type=str(dtype),
        type_info=f"numpy.{dtype}",
    )


@pytest.mark.parametrize("value", FLOAT_CASES)
def test_inspect_float(value: float) -> None:
    verify_inspector(
        value=value,
        length=0,
        is_truncated=False,
        display_value=str(value),
        kind=VariableKind.Number,
        display_type="float",
        type_info="float",
    )


@pytest.mark.parametrize("value", COMPLEX_CASES)
def test_inspect_complex(value: complex) -> None:
    verify_inspector(
        value=value,
        length=0,
        is_truncated=False,
        display_value=str(value),
        kind=VariableKind.Number,
        display_type="complex",
        type_info="complex",
    )


#
# Test Classes
#


@pytest.mark.parametrize("value", CLASSES_CASES)
def test_inspect_classes(value: type) -> None:
    verify_inspector(
        value=value,
        length=len([p for p in dir(value) if not (p.startswith("_"))]),
        has_children=True,
        is_truncated=False,
        display_value=str(value),
        kind=VariableKind.Class,
        display_type="type",
        type_info="type",
        supports_deepcopy=False,
    )


#
# Test Bytes
#


@pytest.mark.parametrize("value", BYTES_CASES)
def test_inspect_bytes(value: bytes) -> None:
    length = len(value)
    verify_inspector(
        value=value,
        is_truncated=False,
        display_value=str(value),
        kind=VariableKind.Bytes,
        display_type=f"bytes [{length}]",
        type_info="bytes",
        length=length,
    )


BYTEARRAY_CASES = [
    bytearray(),
    bytearray(0),
    bytearray(1),
    bytearray(b"\x41\x42\x43"),
]


@pytest.mark.parametrize("value", BYTEARRAY_CASES)
def test_inspect_bytearray(value: bytearray) -> None:
    length = len(value)
    verify_inspector(
        value=value,
        is_truncated=False,
        display_value=str(value),
        kind=VariableKind.Bytes,
        display_type=f"bytearray [{length}]",
        type_info="bytearray",
        length=length,
        mutable=True,
        mutate=lambda x: x.append(0),
    )


def test_inspect_bytearray_truncated() -> None:
    value = bytearray(TRUNCATE_AT * 2)
    length = len(value)
    verify_inspector(
        value=value,
        display_value=str(value)[:TRUNCATE_AT],
        kind=VariableKind.Bytes,
        display_type=f"bytearray [{length}]",
        type_info="bytearray",
        length=length,
        is_truncated=True,
        mutable=True,
        mutate=lambda x: x.append(0),
    )


def test_inspect_memoryview() -> None:
    byte_array = bytearray("東京", "utf-8")
    value = memoryview(byte_array)
    length = len(value)
    verify_inspector(
        value=value,
        is_truncated=False,
        display_value=str(value),
        kind=VariableKind.Bytes,
        display_type=f"memoryview [{length}]",
        type_info="memoryview",
        length=length,
        supports_deepcopy=False,
    )


#
# Test Timestamps
#


@pytest.mark.parametrize("value", TIMESTAMP_CASES)
def test_inspect_timestamp(value: datetime.datetime) -> None:
    verify_inspector(
        value=value,
        length=0,
        is_truncated=False,
        display_value=repr(value),
        kind=VariableKind.Other,
        display_type=type(value).__name__,
        type_info=get_qualname(value),
    )


#
# Test Empty
#

NONE_CASES = [None]


@pytest.mark.parametrize("value", NONE_CASES)
def test_inspect_none(value: None) -> None:
    verify_inspector(
        value=value,
        length=0,
        is_truncated=False,
        display_value="None",
        kind=VariableKind.Empty,
        display_type="NoneType",
        type_info="NoneType",
    )


#
# Test Collections
#

SET_CASES = [
    set(),
    set([None]),
    set(BOOL_CASES),
    set(INT_CASES),
    set(FLOAT_CASES),
    set(COMPLEX_CASES),
    set(BYTES_CASES),
    set(STRING_CASES),
]


@pytest.mark.parametrize("value", SET_CASES)
def test_inspect_set(value: set) -> None:
    length = len(value)
    verify_inspector(
        value=value,
        is_truncated=False,
        display_value=pprint.pformat(value, width=PRINT_WIDTH, compact=True),
        kind=VariableKind.Collection,
        display_type=f"set {{{length}}}",
        type_info="set",
        length=length,
        supports_deepcopy=False,
    )


def test_inspect_set_truncated() -> None:
    value = set(list(range(TRUNCATE_AT * 2)))
    length = len(value)
    verify_inspector(
        value=value,
        display_value=pprint.pformat(value, width=PRINT_WIDTH, compact=True)[:TRUNCATE_AT],
        kind=VariableKind.Collection,
        display_type=f"set {{{length}}}",
        type_info="set",
        length=length,
        is_truncated=True,
        supports_deepcopy=False,
    )


LIST_WITH_CYCLE = list([1, 2])
LIST_WITH_CYCLE.append(LIST_WITH_CYCLE)  # type: ignore
LIST_CASES = [
    [],
    NONE_CASES,
    BOOL_CASES,
    INT_CASES,
    FLOAT_CASES,
    COMPLEX_CASES,
    BYTES_CASES,
    BYTEARRAY_CASES,
    STRING_CASES,
    LIST_WITH_CYCLE,
]


@pytest.mark.parametrize("value", LIST_CASES)
def test_inspect_list(value: list) -> None:
    length = len(value)
    verify_inspector(
        value=value,
        is_truncated=False,
        display_value=pprint.pformat(value, width=PRINT_WIDTH, compact=True),
        kind=VariableKind.Collection,
        display_type=f"list [{length}]",
        type_info="list",
        length=length,
        has_children=length > 0,
        supports_deepcopy=False,
    )


def test_inspect_list_truncated() -> None:
    value = list(range(TRUNCATE_AT * 2))
    length = len(value)
    verify_inspector(
        value=value,
        display_value=pprint.pformat(value, width=PRINT_WIDTH, compact=True)[:TRUNCATE_AT],
        kind=VariableKind.Collection,
        display_type=f"list [{length}]",
        type_info="list",
        length=length,
        has_children=True,
        is_truncated=True,
        supports_deepcopy=False,
    )


@pytest.mark.parametrize("value", RANGE_CASES)
def test_inspect_range(value: range) -> None:
    length = len(value)
    verify_inspector(
        value=value,
        is_truncated=False,
        display_value=pprint.pformat(value, width=PRINT_WIDTH, compact=True),
        kind=VariableKind.Collection,
        display_type=f"range [{length}]",
        type_info="range",
        length=length,
    )


FASTCORE_LIST_CASES = [
    L(),
    L(NONE_CASES),
    L(BOOL_CASES),
    L(INT_CASES),
    L(FLOAT_CASES),
    L(COMPLEX_CASES),
    L(BYTES_CASES),
    L(BYTEARRAY_CASES),
    L(STRING_CASES),
]


@pytest.mark.parametrize("value", FASTCORE_LIST_CASES)
def test_inspect_fastcore_list(value: L) -> None:
    length = len(value)
    verify_inspector(
        value=value,
        is_truncated=False,
        display_value=pprint.pformat(value, width=PRINT_WIDTH, compact=True),
        kind=VariableKind.Collection,
        display_type=f"L [{length}]",
        type_info="fastcore.foundation.L",
        length=length,
        has_children=length > 0,
        supports_deepcopy=False,
    )


#
# Test Maps
#


MAP_WITH_CYCLE = {}
MAP_WITH_CYCLE["cycle"] = MAP_WITH_CYCLE
MAP_CASES = [
    {},  # empty dict
    {"": None},  # empty key
    {10: "Ten"},  # int key
    {"A": True},  # bool value
    {"B": 1},  # int value
    {"C": -1.01},  # float value
    {"D": complex(1, 2)},  # complex value
    {"E": "Echo"},  # str value
    {"F": b"Foxtrot"},  # bytes value
    {"G": bytearray(b"\x41\x42\x43")},  # byterray value
    {"H": (1, 2, 3)},  # tuple value
    {"I": [1, 2, 3]},  # list value
    {"J": {1, 2, 3}},  # set value
    {"K": range(3)},  # range value
    {"L": {"L1": 1, "L2": 2, "L3": 3}},  # nested dict value
    MAP_WITH_CYCLE,
]


@pytest.mark.parametrize("value", MAP_CASES)
def test_inspect_map(value: dict) -> None:
    length = len(value)
    verify_inspector(
        value=value,
        is_truncated=False,
        display_value=pprint.pformat(value, width=PRINT_WIDTH, compact=True),
        kind=VariableKind.Map,
        display_type=f"dict [{length}]",
        type_info="dict",
        length=length,
        has_children=length > 0,
        supports_deepcopy=False,
    )


#
# Test Functions
#
helper = HelperClass()


FUNCTION_CASES = [
    lambda: None,  # No argument lambda function
    lambda x: x,  # Single argument lambda function
    lambda x, y: x + y,  # Multiple argument lambda function
    helper.fn_no_args,  # No argument method
    helper.fn_one_arg,  # Single argument method with single return type
    helper.fn_two_args,  # Multiple argument method with tuple return type
]


@pytest.mark.parametrize("value", FUNCTION_CASES)
def test_inspect_function(value: Callable) -> None:
    expected_type = "method" if isinstance(value, types.MethodType) else "function"
    verify_inspector(
        value=value,
        length=0,
        is_truncated=False,
        display_value=f"{value.__qualname__}{inspect.signature(value)}",
        kind=VariableKind.Function,
        display_type=expected_type,
        type_info=expected_type,
    )


#
# Test objects
#

OBJECTS_CASES = [helper]


@pytest.mark.parametrize("value", OBJECTS_CASES)
def test_inspect_object(value: Any) -> None:
    verify_inspector(
        value=value,
        length=4,
        has_children=True,
        is_truncated=False,
        display_value=str(value),
        kind=VariableKind.Other,
        display_type="HelperClass",
        type_info="positron_ipykernel.tests.test_inspectors.HelperClass",
        supports_deepcopy=False,
    )


#
# Test property
#
PROPERTY_CASES = [HelperClass.prop]


@pytest.mark.parametrize("value", PROPERTY_CASES)
def test_inspect_property(value: property) -> None:
    verify_inspector(
        value=value,
        length=0,
        is_truncated=False,
        display_value=str(value),
        kind=VariableKind.Other,
        display_type="property",
        type_info="property",
    )


#
# Test arrays
#


@pytest.mark.parametrize(
    "value",
    [
        np.array([1, 2, 3], dtype=np.int64),  # 1D
        np.array([[1, 2, 3], [4, 5, 6]], dtype=np.int64),  # 2D
    ],
)
def test_inspect_numpy_array(value: np.ndarray) -> None:
    shape = value.shape
    display_shape = f"({shape[0]})" if len(shape) == 1 else str(tuple(shape))
    verify_inspector(
        value=value,
        display_value=np.array2string(value, separator=","),
        kind=VariableKind.Collection,
        display_type=f"numpy.int64 {display_shape}",
        type_info="numpy.ndarray",
        has_children=True,
        is_truncated=True,
        length=shape[0],
        mutable=True,
        mutate=lambda x: x.fill(0),
    )


@pytest.mark.parametrize(
    "value",
    [
        np.array(1, dtype=np.int64),
    ],
)
def test_inspect_numpy_array_0d(value: np.ndarray) -> None:
    verify_inspector(
        value=value,
        display_value=np.array2string(value, separator=","),
        kind=VariableKind.Number,
        display_type="numpy.int64",
        type_info="numpy.ndarray",
        is_truncated=True,
        length=0,
        mutable=True,
        mutate=lambda x: x.fill(0),
    )


#
# Test tables
#


def test_inspect_pandas_dataframe() -> None:
    value = pd.DataFrame({"a": [1, 2], "b": ["3", "4"]})
    rows, cols = value.shape

    def mutate(x):
        x["c"] = [5, 6]

    verify_inspector(
        value=value,
        display_value=f"[{rows} rows x {cols} columns] {get_type_as_str(value)}",
        kind=VariableKind.Table,
        display_type=f"DataFrame [{rows}x{cols}]",
        type_info=get_type_as_str(value),
        has_children=True,
        has_viewer=True,
        is_truncated=True,
        length=rows,
        mutable=True,
        mutate=mutate,
    )


@pytest.mark.parametrize(
    "value",
    [
        pd.RangeIndex(0, 2),
        pd.Index([0, 1]),
        pd.date_range("2021-01-01 00:00:00", "2021-01-01 02:00:00", freq="h"),
        pd.MultiIndex.from_tuples([(0, "a"), (1, "b"), (2, "c")]),
    ],
)
def test_inspect_pandas_index(value: pd.Index) -> None:
    (rows,) = value.shape
    not_range_index = not isinstance(value, pd.RangeIndex)

    verify_inspector(
        value=value,
        display_value=str(value.to_list() if not_range_index else value),
        kind=VariableKind.Map,
        display_type=f"{value.dtype} [{rows}]",
        type_info=get_qualname(value),
        has_children=not_range_index,
        is_truncated=not_range_index,
        length=rows,
    )


def test_inspect_pandas_series() -> None:
    value = pd.Series({"a": 0, "b": 1})
    (rows,) = value.shape

    def mutate(x):
        x["a"] = 1

    verify_inspector(
        value=value,
        display_value="[0, 1]",
        kind=VariableKind.Map,
        display_type=f"int64 [{rows}]",
        type_info=get_type_as_str(value),
        has_children=True,
        is_truncated=True,
        length=rows,
        mutable=True,
        mutate=mutate,
    )


def test_inspect_polars_dataframe() -> None:
    value = pl.DataFrame({"a": [1, 2], "b": [3, 4]})
    rows, cols = value.shape
    verify_inspector(
        value=value,
        display_value=f"[{rows} rows x {cols} columns] {get_type_as_str(value)}",
        kind=VariableKind.Table,
        display_type=f"DataFrame [{rows}x{cols}]",
        type_info=get_type_as_str(value),
        has_children=True,
        has_viewer=True,
        is_truncated=True,
        length=rows,
        mutable=True,
        mutate=lambda x: x.drop_in_place("a"),
    )


def test_inspect_polars_series() -> None:
    value = pl.Series([0, 1])
    (rows,) = value.shape

    def mutate(x):
        x[0] = 1

    verify_inspector(
        value=value,
        display_value="[0, 1]",
        kind=VariableKind.Map,
        display_type=f"Int64 [{rows}]",
        type_info=get_type_as_str(value),
        has_children=True,
        is_truncated=True,
        length=rows,
        mutable=True,
        mutate=mutate,
    )


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (pd.Series({"a": 0, "b": 1}), ["a", "b"]),
        (pl.Series([0, 1]), range(0, 2)),
        (pd.DataFrame({"a": [1, 2], "b": ["3", "4"]}), ["a", "b"]),
        (pl.DataFrame({"a": [1, 2], "b": ["3", "4"]}), ["a", "b"]),
        (pd.Index([0, 1]), range(0, 2)),
        (
            pd.Index([datetime.datetime(2021, 1, 1), datetime.datetime(2021, 1, 2)]),
            range(0, 2),
        ),
        (np.array([0, 1]), range(0, 2)),  # 1D
        (np.array([[0, 1], [2, 3]]), range(0, 2)),  # 2D
    ],
)
def test_get_children(data: Any, expected: Iterable) -> None:
    children = get_inspector(data).get_children()

    if isinstance(children, pd.Index):
        children = children.to_list()

    assert children == expected


@pytest.mark.parametrize(
    ("value", "key", "expected"),
    [
        (helper, "fn_no_args", helper.fn_no_args),
        (pd.Series({"a": 0, "b": 1}), "a", 0),
        (pl.Series([0, 1]), 0, 0),
        (
            pd.DataFrame({"a": [1, 2], "b": ["3", "4"]}),
            "a",
            pd.Series([1, 2], name="a"),
        ),
        (
            pl.DataFrame({"a": [1, 2], "b": ["3", "4"]}),
            "a",
            pl.Series(values=[1, 2], name="a"),
        ),
        (pd.Index([0, 1]), 0, 0),
        (
            pd.Index([datetime.datetime(2021, 1, 1), datetime.datetime(2021, 1, 2)]),
            0,
            datetime.datetime(2021, 1, 1),
        ),
        (np.array([0, 1]), 0, 0),  # 1D
        (np.array([[0, 1], [2, 3]]), 0, [0, 1]),  # 2D
    ],
)
def test_get_child(value: Any, key: Any, expected: Any) -> None:
    child = get_inspector(value).get_child(key)
    assert get_inspector(child).equals(expected)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (np.array([[1, 2, 3], [4, 5, 6]], dtype="int64"), 48),
        (torch.Tensor([[1, 2, 3], [4, 5, 6]]) if torch else None, 24),
        (pd.Series([1, 2, 3, 4]), 32),
        (pl.Series([1, 2, 3, 4]), 32),
        (pd.DataFrame({"a": [1, 2], "b": ["3", "4"]}), 32),
        (pl.DataFrame({"a": [1, 2], "b": ["3", "4"]}), 32),
        (pd.Index([0, 1]), 16),
    ],
)
def test_arrays_maps_get_size(value: Any, expected: int) -> None:
    if value is None:
        return
    inspector = get_inspector(value)
    assert inspector.get_size() == expected
