#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

from __future__ import annotations

import asyncio
import inspect
import math
import pprint
import random
import string
import sys
import types
from typing import Any, List, cast, Callable, Iterable, Optional, Tuple

import comm
import numpy as np
import pandas as pd
import polars as pl
import pytest
from fastcore.foundation import L
from IPython.terminal.interactiveshell import TerminalInteractiveShell

from positron import (
    PRINT_WIDTH,
    TRUNCATE_AT,
    EnvironmentService,
    EnvironmentVariable,
    EnvironmentVariableValueKind,
)
from positron.inspectors import get_inspector
from positron.positron_ipkernel import PositronIPyKernel

from .conftest import DummyComm


@pytest.fixture
def env_service(
    kernel: PositronIPyKernel,
) -> Iterable[EnvironmentService]:
    """
    A Positron environment service with an open comm.
    """
    env_service = kernel.env_service

    # Close any existing comm
    if env_service.env_comm is not None:
        env_service.env_comm.close()
        env_service.env_comm = None

    # Open a comm
    env_comm = cast(DummyComm, comm.create_comm("positron.environment"))
    open_msg = {}
    env_service.on_comm_open(env_comm, open_msg)

    # Clear messages due to the comm_open
    env_comm.messages.clear()

    yield env_service

    # Close the comm
    env_comm.close()
    env_service.env_comm = None


@pytest.fixture
def env_comm(env_service: EnvironmentService) -> DummyComm:
    """
    Convenience fixture for accessing the environment comm.
    """
    return cast(DummyComm, env_service.env_comm)


#
# Helpers
#


def assert_environment_variable_equal(
    result: Optional[EnvironmentVariable], expected: EnvironmentVariable
) -> None:
    assert result is not None

    # Don't compare size
    exclude = {"size"}
    result_dict = result.dict(exclude=exclude)
    expected_dict = expected.dict(exclude=exclude)

    assert result_dict == expected_dict


def assert_environment_variables_equal(
    result: List[EnvironmentVariable], expected: List[EnvironmentVariable]
) -> None:
    assert len(result) == len(expected)

    for result_item, expected_item in zip(result, expected):
        assert_environment_variable_equal(result_item, expected_item)


class Ignore:
    """
    An object that's equal to every other object.
    """

    def __eq__(self, other: Any) -> bool:
        return True


IGNORE = Ignore()


class HelperClass:
    """
    A helper class for testing method functions.
    """

    def fn_no_args(self):
        return "No args"

    def fn_one_arg(self, x: str) -> str:
        return f"One arg {x}"

    def fn_two_args(self, x: int, y: int) -> Tuple[int, int]:
        return (x, y)


#
# Test Booleans
#

BOOL_CASES = set([True, False])


@pytest.mark.parametrize("case", BOOL_CASES)
def test_summarize_boolean(case: bool, env_service: EnvironmentService) -> None:
    display_name = "xBool"
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=str(case),
        kind=EnvironmentVariableValueKind.boolean,
        display_type="bool",
        type_info="bool",
        access_key=display_name,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


#
# Test Strings
#

STRING_CASES = set(
    [
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
)


@pytest.mark.parametrize("case", STRING_CASES)
def test_summarize_string(case: str, env_service: EnvironmentService) -> None:
    display_name = "xStr"
    length = len(case)
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=repr(case),
        kind=EnvironmentVariableValueKind.string,
        display_type="str",
        type_info="str",
        access_key=display_name,
        length=length,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


def test_summarize_string_truncated(env_service: EnvironmentService) -> None:
    display_name = "xStrT"
    long_string = "".join(random.choices(string.ascii_letters, k=(TRUNCATE_AT + 10)))
    length = len(long_string)
    expected_value = f"'{long_string[:TRUNCATE_AT]}'"
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=expected_value,
        kind=EnvironmentVariableValueKind.string,
        display_type="str",
        type_info="str",
        access_key=display_name,
        length=length,
        is_truncated=True,
    )

    result = env_service._summarize_variable(display_name, long_string)

    assert_environment_variable_equal(result, expected)


#
# Test Numbers
#

# Python 3 ints are unbounded, but we include a few large numbers
# for basic test cases
INT_CASES = set([-sys.maxsize * 100, -sys.maxsize, -1, 0, 1, sys.maxsize, sys.maxsize * 100])


@pytest.mark.parametrize("case", INT_CASES)
def test_summarize_integer(case: int, env_service: EnvironmentService) -> None:
    display_name = "xInt"
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=str(case),
        kind=EnvironmentVariableValueKind.number,
        display_type="int",
        type_info="int",
        access_key=display_name,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


FLOAT_CASES = set(
    [
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
)


@pytest.mark.parametrize("case", FLOAT_CASES)
def test_summarize_float(case: float, env_service: EnvironmentService) -> None:
    display_name = "xFloat"
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=str(case),
        kind=EnvironmentVariableValueKind.number,
        display_type="float",
        type_info="float",
        access_key=display_name,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


COMPLEX_CASES = set(
    [
        complex(-1.0, 100.1),
        complex(-1.0, 0.0),
        complex(0, 0),
        complex(1.0, 0.0),
        complex(1.0, 100.1),
    ]
)


@pytest.mark.parametrize("case", COMPLEX_CASES)
def test_summarize_complex(case: complex, env_service: EnvironmentService) -> None:
    display_name = "xComplex"
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=str(case),
        kind=EnvironmentVariableValueKind.number,
        display_type="complex",
        type_info="complex",
        access_key=display_name,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


#
# Test Bytes
#

BYTES_CASES = set([b"", b"\x00", b"caff\\xe8"])


@pytest.mark.parametrize("case", BYTES_CASES)
def test_summarize_bytes(case: bytes, env_service: EnvironmentService) -> None:
    display_name = "xBytes"
    length = len(case)
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=str(case),
        kind=EnvironmentVariableValueKind.bytes,
        display_type=f"bytes [{length}]",
        type_info="bytes",
        access_key=display_name,
        length=length,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


BYTEARRAY_CASES = list([bytearray(), bytearray(0), bytearray(1), bytearray(b"\x41\x42\x43")])


@pytest.mark.parametrize("case", BYTEARRAY_CASES)
def test_summarize_bytearray(case: bytearray, env_service: EnvironmentService) -> None:
    display_name = "xBytearray"
    length = len(case)
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=str(case),
        kind=EnvironmentVariableValueKind.bytes,
        display_type=f"bytearray [{length}]",
        type_info="bytearray",
        access_key=display_name,
        length=length,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


def test_summarize_bytearray_truncated(env_service: EnvironmentService) -> None:
    display_name = "xBytearrayT"
    case = bytearray(TRUNCATE_AT * 2)
    length = len(case)
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=str(case)[:TRUNCATE_AT],
        kind=EnvironmentVariableValueKind.bytes,
        display_type=f"bytearray [{length}]",
        type_info="bytearray",
        access_key=display_name,
        length=length,
        is_truncated=True,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


def test_summarize_memoryview(env_service: EnvironmentService) -> None:
    display_name = "xMemoryview"
    byte_array = bytearray("東京", "utf-8")
    case = memoryview(byte_array)
    length = len(case)
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=str(case),
        kind=EnvironmentVariableValueKind.bytes,
        display_type=f"memoryview [{length}]",
        type_info="memoryview",
        access_key=display_name,
        length=length,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


#
# Test Empty
#


def test_summarize_none(env_service: EnvironmentService) -> None:
    display_name = "xNone"
    case = None
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value="None",
        kind=EnvironmentVariableValueKind.empty,
        display_type="NoneType",
        type_info="NoneType",
        access_key=display_name,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


#
# Test Collections
#


@pytest.mark.parametrize(
    "case",
    [
        set(),
        set([None]),
        set(BOOL_CASES),
        set(INT_CASES),
        set(FLOAT_CASES),
        set(COMPLEX_CASES),
        set(BYTES_CASES),
        set(STRING_CASES),
    ],
)
def test_summarize_set(case: set, env_service: EnvironmentService) -> None:
    display_name = "xSet"
    length = len(case)
    expected_value = pprint.pformat(case, width=PRINT_WIDTH, compact=True)
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=expected_value,
        kind=EnvironmentVariableValueKind.collection,
        display_type=f"set {{{length}}}",
        type_info="set",
        access_key=display_name,
        length=length,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


def test_summarize_set_truncated(env_service: EnvironmentService) -> None:
    display_name = "xSetT"
    case = set(list(range(TRUNCATE_AT * 2)))
    length = len(case)
    expected_value = pprint.pformat(case, width=PRINT_WIDTH, compact=True)
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=expected_value[:TRUNCATE_AT],
        kind=EnvironmentVariableValueKind.collection,
        display_type=f"set {{{length}}}",
        type_info="set",
        access_key=display_name,
        length=length,
        is_truncated=True,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


@pytest.mark.parametrize(
    "case",
    [
        list(),
        list([None]),
        list(BOOL_CASES),
        list(INT_CASES),
        list(FLOAT_CASES),
        list(COMPLEX_CASES),
        list(BYTES_CASES),
        list(BYTEARRAY_CASES),
        list(STRING_CASES),
    ],
)
def test_summarize_list(case: list, env_service: EnvironmentService) -> None:
    display_name = "xList"
    length = len(case)
    expected_value = pprint.pformat(case, width=PRINT_WIDTH, compact=True)
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=expected_value,
        kind=EnvironmentVariableValueKind.collection,
        display_type=f"list [{length}]",
        type_info="list",
        access_key=display_name,
        length=length,
        has_children=length > 0,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


def test_summarize_list_truncated(env_service: EnvironmentService) -> None:
    display_name = "xListT"
    case = list(range(TRUNCATE_AT * 2))
    length = len(case)
    expected_value = pprint.pformat(case, width=PRINT_WIDTH, compact=True)
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=expected_value[:TRUNCATE_AT],
        kind=EnvironmentVariableValueKind.collection,
        display_type=f"list [{length}]",
        type_info="list",
        access_key=display_name,
        length=length,
        has_children=True,
        is_truncated=True,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


def test_summarize_list_cycle(env_service: EnvironmentService) -> None:
    display_name = "xListCycle"
    case = list([1, 2])
    case.append(case)  # type: ignore
    length = len(case)
    expected_value = pprint.pformat(case, width=PRINT_WIDTH, compact=True)
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=expected_value[:TRUNCATE_AT],
        kind=EnvironmentVariableValueKind.collection,
        display_type=f"list [{length}]",
        type_info="list",
        access_key=display_name,
        length=length,
        has_children=True,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


@pytest.mark.parametrize(
    "case",
    [
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
    ],
)
def test_summarize_range(case: range, env_service: EnvironmentService) -> None:
    display_name = "xRange"
    length = len(case)
    expected_value = pprint.pformat(case, width=PRINT_WIDTH, compact=True)
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=expected_value,
        kind=EnvironmentVariableValueKind.collection,
        display_type=f"range [{length}]",
        type_info="range",
        access_key=display_name,
        length=length,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


@pytest.mark.parametrize(
    "case",
    [
        L(),
        L([None]),
        L(BOOL_CASES),
        L(INT_CASES),
        L(FLOAT_CASES),
        L(COMPLEX_CASES),
        L(BYTES_CASES),
        L(BYTEARRAY_CASES),
        L(STRING_CASES),
    ],
)
def test_summarize_fastcore_list(case: L, env_service: EnvironmentService) -> None:
    display_name = "xFastcoreList"
    length = len(case)
    expected_value = pprint.pformat(case, width=PRINT_WIDTH, compact=True)
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=expected_value,
        kind=EnvironmentVariableValueKind.collection,
        display_type=f"L [{length}]",
        type_info="fastcore.foundation.L",
        access_key=display_name,
        length=length,
        has_children=length > 0,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


#
# Test Maps
#


@pytest.mark.parametrize(
    "case",
    [
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
    ],
)
def test_summarize_map(case: dict, env_service: EnvironmentService) -> None:
    display_name = "xDict"
    length = len(case)
    expected_value = pprint.pformat(case, width=PRINT_WIDTH, compact=True)
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=expected_value,
        kind=EnvironmentVariableValueKind.map,
        display_type=f"dict [{length}]",
        type_info="dict",
        access_key=display_name,
        length=length,
        has_children=length > 0,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


#
# Test Functions
#
helper = HelperClass()


@pytest.mark.parametrize(
    "case",
    [
        lambda: None,  # No argument lambda function
        lambda x: x,  # Single argument lambda function
        lambda x, y: x + y,  # Multiple argument lambda function
        helper.fn_no_args,  # No argument method
        helper.fn_one_arg,  # Single argument method with single return type
        helper.fn_two_args,  # Multiple argument method with tuple return type
    ],
)
def test_summarize_function(case: Callable, env_service: EnvironmentService) -> None:
    display_name = "xFn"
    expected_value = f"{case.__qualname__}{inspect.signature(case)}"
    expected_type = "function"
    if isinstance(case, types.MethodType):
        expected_type = "method"
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=expected_value,
        kind=EnvironmentVariableValueKind.function,
        display_type=expected_type,
        type_info=expected_type,
        access_key=display_name,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


#
# Test arrays
#


@pytest.mark.parametrize(
    "case",
    [
        np.array([1, 2, 3], dtype=np.int64),  # 1D
        np.array([[1, 2, 3], [4, 5, 6]], dtype=np.int64),  # 2D
    ],
)
def test_summarize_numpy_array(case: np.ndarray, env_service: EnvironmentService) -> None:
    display_name = "xNumpyArray"
    shape = case.shape
    display_shape = f"({shape[0]})" if len(shape) == 1 else str(tuple(shape))
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=np.array2string(case, separator=","),
        kind=EnvironmentVariableValueKind.collection,
        display_type=f"numpy.int64 {display_shape}",
        type_info="numpy.ndarray",
        access_key=display_name,
        has_children=True,
        is_truncated=True,
        length=shape[0],
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


@pytest.mark.parametrize(
    "case",
    [
        np.array(1, dtype=np.int64),
    ],
)
def test_summarize_numpy_array_0d(case: np.ndarray, env_service: EnvironmentService) -> None:
    display_name = "xNumpyArray0d"
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=np.array2string(case, separator=","),
        kind=EnvironmentVariableValueKind.number,
        display_type=f"numpy.int64",
        type_info="numpy.ndarray",
        access_key=display_name,
        has_children=False,
        is_truncated=True,
        length=0,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


def test_summarize_children_numpy_array(env_service: EnvironmentService) -> None:
    case = np.array([[1, 2, 3], [4, 5, 6]], dtype=np.int64)

    inspector = get_inspector(case)
    summary = inspector.summarize_children(case, env_service._summarize_variable)

    assert summary == [
        EnvironmentVariable(
            access_key="0",
            display_name="0",
            display_value="[1,2,3]",
            display_type="numpy.int64 (3)",
            type_info="numpy.ndarray",
            kind=EnvironmentVariableValueKind.collection,
            length=3,
            size=112,
            has_children=True,
            has_viewer=False,
            is_truncated=True,
        ),
        EnvironmentVariable(
            access_key="1",
            display_name="1",
            display_value="[4,5,6]",
            display_type="numpy.int64 (3)",
            type_info="numpy.ndarray",
            kind=EnvironmentVariableValueKind.collection,
            length=3,
            size=112,
            has_children=True,
            has_viewer=False,
            is_truncated=True,
        ),
    ]


#
# Test tables
#


def test_summarize_pandas_dataframe(env_service: EnvironmentService) -> None:
    case = pd.DataFrame({"a": [1, 2], "b": ["3", "4"]})

    display_name = "xPandasDataFrame"
    rows, cols = case.shape
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=f"[{rows} rows x {cols} columns] pandas.core.frame.DataFrame",
        kind=EnvironmentVariableValueKind.table,
        display_type=f"DataFrame [{rows}x{cols}]",
        type_info="pandas.core.frame.DataFrame",
        access_key=display_name,
        has_children=True,
        has_viewer=True,
        is_truncated=True,
        length=rows,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


def test_summarize_children_pandas_dataframe(env_service: EnvironmentService) -> None:
    case = pd.DataFrame({"a": [1, 2], "b": ["3", "4"]})

    inspector = get_inspector(case)
    summary = inspector.summarize_children(case, env_service._summarize_variable)

    assert_environment_variables_equal(
        summary,
        [
            EnvironmentVariable(
                access_key="a",
                display_name="a",
                display_value="[1, 2]",
                display_type="int64 [2]",
                type_info="pandas.core.series.Series",
                kind=EnvironmentVariableValueKind.collection,
                length=2,
                has_children=True,
                has_viewer=False,
                is_truncated=True,
            ),
            EnvironmentVariable(
                access_key="b",
                display_name="b",
                display_value="['3', '4']",
                display_type="object [2]",
                type_info="pandas.core.series.Series",
                kind=EnvironmentVariableValueKind.collection,
                length=2,
                has_children=True,
                has_viewer=False,
                is_truncated=True,
            ),
        ],
    )


def test_summarize_pandas_series(env_service: EnvironmentService) -> None:
    case = pd.Series({"a": 0, "b": 1})

    display_name = "xPandasSeries"
    (rows,) = case.shape
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value="[0, 1]",
        kind=EnvironmentVariableValueKind.collection,
        display_type=f"Series [{rows}]",
        type_info="pandas.core.series.Series",
        access_key=display_name,
        has_children=True,
        is_truncated=True,
        length=rows,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


def test_summarize_polars_dataframe(env_service: EnvironmentService) -> None:
    case = pl.DataFrame({"a": [1, 2], "b": [3, 4]})

    display_name = "xPolarsDataFrame"
    rows, cols = case.shape
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value=f"[{rows} rows x {cols} columns] polars.dataframe.frame.DataFrame",
        kind=EnvironmentVariableValueKind.table,
        display_type=f"DataFrame [{rows}x{cols}]",
        type_info="polars.dataframe.frame.DataFrame",
        access_key=display_name,
        has_children=True,
        has_viewer=True,
        is_truncated=True,
        length=rows,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


def test_summarize_children_polars_dataframe(env_service: EnvironmentService) -> None:
    case = pl.DataFrame({"a": [1, 2], "b": ["3", "4"]})

    inspector = get_inspector(case)
    summary = inspector.summarize_children(case, env_service._summarize_variable)

    assert_environment_variables_equal(
        summary,
        [
            EnvironmentVariable(
                access_key="a",
                display_name="a",
                display_value="[1, 2]",
                display_type="Int64 [2]",
                type_info="polars.series.series.Series",
                kind=EnvironmentVariableValueKind.collection,
                length=2,
                has_children=True,
                has_viewer=False,
                is_truncated=True,
            ),
            EnvironmentVariable(
                access_key="b",
                display_name="b",
                display_value="['3', '4']",
                display_type="Utf8 [2]",
                type_info="polars.series.series.Series",
                kind=EnvironmentVariableValueKind.collection,
                length=2,
                has_children=True,
                has_viewer=False,
                is_truncated=True,
            ),
        ],
    )


def test_summarize_polars_series(env_service: EnvironmentService) -> None:
    case = pl.Series([0, 1])

    display_name = "xPolarsSeries"
    (rows,) = case.shape
    expected = EnvironmentVariable(
        display_name=display_name,
        display_value="[0, 1]",
        kind=EnvironmentVariableValueKind.collection,
        display_type=f"Series [{rows}]",
        type_info="polars.series.series.Series",
        access_key=display_name,
        has_children=True,
        is_truncated=True,
        length=rows,
    )

    result = env_service._summarize_variable(display_name, case)

    assert_environment_variable_equal(result, expected)


#
# End-to-end tests
#


# We purposefully use the kernel fixture instead of env_service or env_comm
# so that the comm is not yet opened.
def test_comm_open(kernel: PositronIPyKernel) -> None:
    env_service = kernel.env_service

    # Double-check that comm is not yet open
    assert env_service.env_comm is None

    # Open a comm
    env_comm = cast(DummyComm, comm.create_comm("positron.environment"))
    open_msg = {}
    env_service.on_comm_open(env_comm, open_msg)

    # Check that the comm_open and (empty) list messages were sent
    assert env_comm.messages == [
        {
            "data": {},
            "metadata": None,
            "buffers": None,
            "target_name": "positron.environment",
            "target_module": None,
            "msg_type": "comm_open",
        },
        {
            "data": {
                "msg_type": "list",
                "variables": [],
                "length": 0,
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        },
    ]


def test_numpy_assign_and_update(shell: TerminalInteractiveShell, env_comm: DummyComm) -> None:
    """
    Test environment change detection for numpy arrays.
    """

    shell.run_cell(
        """import numpy as np
x = np.array(3, dtype=np.int64)"""
    )

    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "update",
                "assigned": [
                    {
                        "display_name": "x",
                        "display_value": "3",
                        "kind": "number",
                        "display_type": "numpy.int64",
                        "type_info": "numpy.ndarray",
                        "access_key": "x",
                        "length": 0,
                        "size": IGNORE,
                        "has_children": False,
                        "has_viewer": False,
                        "is_truncated": True,
                    }
                ],
                "removed": set(),
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]

    shell.run_cell("x = np.array([3], dtype=np.int64)")

    assert env_comm.messages[-1] == {
        "data": {
            "msg_type": "update",
            "assigned": [
                {
                    "display_name": "x",
                    "display_value": "[3]",
                    "kind": "collection",
                    "display_type": "numpy.int64 (1)",
                    "type_info": "numpy.ndarray",
                    "access_key": "x",
                    "length": 1,
                    "size": IGNORE,
                    "has_children": True,
                    "has_viewer": False,
                    "is_truncated": True,
                }
            ],
            "removed": set(),
        },
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }

    shell.run_cell("x = np.array([[3]], dtype=np.int64)")

    assert env_comm.messages[-1] == {
        "data": {
            "msg_type": "update",
            "assigned": [
                {
                    "display_name": "x",
                    "display_value": "[[3]]",
                    "kind": "collection",
                    "display_type": "numpy.int64 (1, 1)",
                    "type_info": "numpy.ndarray",
                    "access_key": "x",
                    "length": 1,
                    "size": IGNORE,
                    "has_children": True,
                    "has_viewer": False,
                    "is_truncated": True,
                }
            ],
            "removed": set(),
        },
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }


def test_torch_assign_and_update(shell: TerminalInteractiveShell, env_comm: DummyComm) -> None:
    """
    Test environment change detection for pytorch tensors.
    """

    shell.run_cell(
        """import torch
x = torch.tensor(3, dtype=torch.int64)"""
    )

    # Not sure why, but tensor size changes in Python 3.11+
    assert env_comm.messages[-1] == {
        "data": {
            "msg_type": "update",
            "assigned": [
                {
                    "display_name": "x",
                    "display_value": "3",
                    "kind": "number",
                    "display_type": "torch.int64",
                    "type_info": "torch.Tensor",
                    "access_key": "x",
                    "length": 0,
                    "size": IGNORE,
                    "has_children": False,
                    "has_viewer": False,
                    "is_truncated": True,
                }
            ],
            "removed": set(),
        },
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }

    shell.run_cell("x = torch.tensor([3], dtype=torch.int64)")

    assert env_comm.messages[-1] == {
        "data": {
            "msg_type": "update",
            "assigned": [
                {
                    "display_name": "x",
                    "display_value": "[3]",
                    "kind": "collection",
                    "display_type": "torch.int64 (1)",
                    "type_info": "torch.Tensor",
                    "access_key": "x",
                    "length": 1,
                    "size": IGNORE,
                    "has_children": True,
                    "has_viewer": False,
                    "is_truncated": True,
                }
            ],
            "removed": set(),
        },
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }

    shell.run_cell("x = torch.tensor([[3]], dtype=torch.int64)")

    assert env_comm.messages[-1] == {
        "data": {
            "msg_type": "update",
            "assigned": [
                {
                    "display_name": "x",
                    "display_value": "[[3]]",
                    "kind": "collection",
                    "display_type": "torch.int64 (1, 1)",
                    "type_info": "torch.Tensor",
                    "access_key": "x",
                    "length": 1,
                    "size": IGNORE,
                    "has_children": True,
                    "has_viewer": False,
                    "is_truncated": True,
                }
            ],
            "removed": set(),
        },
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }


def test_handle_refresh(shell: TerminalInteractiveShell, env_comm: DummyComm) -> None:
    shell.user_ns.update({"x": 3})

    msg = {"content": {"data": {"msg_type": "refresh"}}}
    env_comm.handle_msg(msg)

    # A list message is sent
    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "list",
                "variables": [
                    {
                        "access_key": "x",
                        "display_name": "x",
                        "display_value": "3",
                        "display_type": "int",
                        "type_info": "int",
                        "kind": "number",
                        "length": 0,
                        "size": IGNORE,
                        "has_children": False,
                        "has_viewer": False,
                        "is_truncated": False,
                    }
                ],
                "length": 1,
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        },
    ]


@pytest.mark.asyncio
async def test_handle_clear(
    shell: TerminalInteractiveShell, env_comm: DummyComm, kernel: PositronIPyKernel
) -> None:
    shell.user_ns.update({"x": 3, "y": 5})

    msg_id = "0"
    msg = {"msg_id": msg_id, "content": {"data": {"msg_type": "clear"}}}
    env_comm.handle_msg(msg)

    # Wait until all resulting kernel tasks are processed
    await asyncio.gather(*kernel._pending_tasks)

    # All user variables are removed
    assert "x" not in shell.user_ns
    assert "y" not in shell.user_ns

    # Update and list messages are sent
    assert env_comm.messages == [
        {
            "data": {"msg_type": "update", "assigned": [], "removed": {"x", "y"}},
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        },
        {
            "data": {"msg_type": "list", "variables": [], "length": 0},
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        },
    ]


def test_handle_delete(shell: TerminalInteractiveShell, env_comm: DummyComm) -> None:
    shell.user_ns.update({"x": 3, "y": 5})

    msg = {"content": {"data": {"msg_type": "delete", "names": ["x"]}}}
    env_comm.handle_msg(msg)

    # Only the `x` variable is removed
    assert "x" not in shell.user_ns
    assert "y" in shell.user_ns

    # An update message is sent
    assert env_comm.messages == [
        {
            "data": {"msg_type": "update", "assigned": [], "removed": {"x"}},
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]


def test_handle_delete_error(env_comm: DummyComm) -> None:
    msg = {"content": {"data": {"msg_type": "delete", "names": ["x"]}}}
    env_comm.handle_msg(msg)

    # No messages are sent
    assert env_comm.messages == []


def test_handle_inspect_number(shell: TerminalInteractiveShell, env_comm: DummyComm) -> None:
    shell.user_ns.update({"x": 3, "y": 5})

    msg = {"content": {"data": {"msg_type": "inspect", "path": ["x"]}}}
    env_comm.handle_msg(msg)

    # A details message is sent
    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "details",
                "path": ["x"],
                "children": [
                    {
                        "access_key": "",
                        "display_name": "",
                        "display_value": "3",
                        "display_type": "int",
                        "type_info": "int",
                        "kind": "number",
                        "length": 0,
                        "size": IGNORE,
                        "has_children": False,
                        "has_viewer": False,
                        "is_truncated": False,
                    }
                ],
                "length": 1,
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        },
    ]


def test_handle_inspect_map(shell: TerminalInteractiveShell, env_comm: DummyComm) -> None:
    # Find an exact match if possible, even if duplicates exist after stringifying.
    shell.user_ns.update({"x": {0: 0, "0": 1}})
    msg = {"content": {"data": {"msg_type": "inspect", "path": ["x", "0"]}}}
    env_comm.handle_msg(msg)

    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "details",
                "path": ["x", "0"],
                "children": [
                    {
                        "access_key": "",
                        "display_name": "",
                        "display_value": "1",
                        "display_type": "int",
                        "type_info": "int",
                        "kind": "number",
                        "length": 0,
                        "size": IGNORE,
                        "has_children": False,
                        "has_viewer": False,
                        "is_truncated": False,
                    }
                ],
                "length": 1,
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]

    # If there's no exact match, return the first child that matches the stringified
    # search path.
    class DummyKey:
        def __str__(self):
            return "0"

    shell.user_ns.update({"x": {DummyKey(): 0, 0: 1}})
    msg = {"content": {"data": {"msg_type": "inspect", "path": ["x", "0"]}}}
    env_comm.messages.clear()
    env_comm.handle_msg(msg)

    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "details",
                "path": ["x", "0"],
                "children": [
                    {
                        "access_key": "",
                        "display_name": "",
                        "display_value": "0",
                        "display_type": "int",
                        "type_info": "int",
                        "kind": "number",
                        "length": 0,
                        "size": IGNORE,
                        "has_children": False,
                        "has_viewer": False,
                        "is_truncated": False,
                    }
                ],
                "length": 1,
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]


def test_handle_inspect_table(shell: TerminalInteractiveShell, env_comm: DummyComm) -> None:
    # Find an exact match if possible, even if duplicates exist after stringifying.
    shell.user_ns.update({"x": pd.DataFrame({0: [0], "0": [1]})})
    msg = {"content": {"data": {"msg_type": "inspect", "path": ["x", "0"]}}}
    env_comm.handle_msg(msg)

    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "details",
                "path": ["x", "0"],
                "children": [
                    {
                        "access_key": "0",
                        "display_name": "0",
                        "display_value": "1",
                        "display_type": "int",
                        "type_info": "int",
                        "kind": "number",
                        "length": 0,
                        "size": IGNORE,
                        "has_children": False,
                        "has_viewer": False,
                        "is_truncated": False,
                    }
                ],
                "length": 1,
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]

    # If there's no exact match, return the first child that matches the stringified
    # search path.
    class DummyKey:
        def __str__(self):
            return "0"

    shell.user_ns.update({"x": pd.DataFrame({DummyKey(): [0], 0: [1]})})
    msg = {"content": {"data": {"msg_type": "inspect", "path": ["x", "0"]}}}
    env_comm.messages.clear()
    env_comm.handle_msg(msg)

    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "details",
                "path": ["x", "0"],
                "children": [
                    {
                        "access_key": "0",
                        "display_name": "0",
                        "display_value": "0",
                        "display_type": "int",
                        "type_info": "int",
                        "kind": "number",
                        "length": 0,
                        "size": IGNORE,
                        "has_children": False,
                        "has_viewer": False,
                        "is_truncated": False,
                    }
                ],
                "length": 1,
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]


def test_handle_inspect_numpy_array_1d(
    shell: TerminalInteractiveShell, env_comm: DummyComm
) -> None:
    shell.user_ns.update({"x": np.array([1, 2], dtype=np.int64)})

    msg = {"content": {"data": {"msg_type": "inspect", "path": ["x"]}}}
    env_comm.handle_msg(msg)

    # A details message is sent
    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "details",
                "path": ["x"],
                "children": [
                    {
                        "access_key": "0",
                        "display_name": "0",
                        "display_value": "1",
                        "display_type": "int64",
                        "type_info": "numpy.int64",
                        "kind": "number",
                        "length": 0,
                        "size": IGNORE,
                        "has_children": False,
                        "has_viewer": False,
                        "is_truncated": False,
                    },
                    {
                        "access_key": "1",
                        "display_name": "1",
                        "display_value": "2",
                        "display_type": "int64",
                        "type_info": "numpy.int64",
                        "kind": "number",
                        "length": 0,
                        "size": IGNORE,
                        "has_children": False,
                        "has_viewer": False,
                        "is_truncated": False,
                    },
                ],
                "length": 2,
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]


def test_handle_inspect_numpy_array_2d(
    shell: TerminalInteractiveShell, env_comm: DummyComm
) -> None:
    shell.user_ns.update({"x": np.array([[1, 2], [3, 4]], dtype=np.int64)})

    msg = {"content": {"data": {"msg_type": "inspect", "path": ["x"]}}}
    env_comm.handle_msg(msg)

    # A details message is sent
    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "details",
                "path": ["x"],
                "children": [
                    {
                        "access_key": "0",
                        "display_name": "0",
                        "display_value": "[1,2]",
                        "display_type": "numpy.int64 (2)",
                        "type_info": "numpy.ndarray",
                        "kind": "collection",
                        "length": 2,
                        "size": IGNORE,
                        "has_children": True,
                        "has_viewer": False,
                        "is_truncated": True,
                    },
                    {
                        "access_key": "1",
                        "display_name": "1",
                        "display_value": "[3,4]",
                        "display_type": "numpy.int64 (2)",
                        "type_info": "numpy.ndarray",
                        "kind": "collection",
                        "length": 2,
                        "size": IGNORE,
                        "has_children": True,
                        "has_viewer": False,
                        "is_truncated": True,
                    },
                ],
                "length": 2,
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]


def test_handle_inspect_error(env_comm: DummyComm) -> None:
    msg = {"content": {"data": {"msg_type": "inspect", "path": ["x"]}}}
    env_comm.handle_msg(msg)

    # An error message is sent
    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "error",
                "message": "Cannot find variable at '['x']' to inspect",
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]


def test_handle_clipboard_format(shell: TerminalInteractiveShell, env_comm: DummyComm) -> None:
    shell.user_ns.update({"x": 3, "y": 5})

    msg = {
        "content": {
            "data": {
                "path": ["x"],
                "msg_type": "clipboard_format",
                "format": "text/plain",
                "data": "Hello, world!",
            }
        }
    }
    env_comm.handle_msg(msg)

    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "formatted_variable",
                "format": "text/plain",
                "content": "3",
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        },
    ]


def test_handle_clipboard_format_error(env_comm: DummyComm) -> None:
    msg = {
        "content": {
            "data": {
                "path": ["x"],
                "msg_type": "clipboard_format",
                "format": "text/plain",
                "data": "Hello, world!",
            }
        }
    }
    env_comm.handle_msg(msg)

    # An error message is sent
    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "error",
                "message": "Cannot find variable at '['x']' to format",
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]


def test_handle_view(
    shell: TerminalInteractiveShell, env_comm: DummyComm, kernel: PositronIPyKernel
) -> None:
    shell.user_ns.update({"x": pd.DataFrame({"a": [0]})})

    msg = {"content": {"data": {"msg_type": "view", "path": "x"}}}
    env_comm.handle_msg(msg)

    # A dataset and comm are added to the dataviewer service
    dataviewer_service = kernel.dataviewer_service
    id = next(iter(dataviewer_service.comms))
    dataset_comm = dataviewer_service.comms[id]
    dataset = dataviewer_service.datasets[id]

    # Check the dataset
    assert dataset == {
        "id": id,
        "title": "x",
        "columns": [{"name": "a", "type": "Series", "data": [0]}],
        "rowCount": 1,
    }

    # Check that the comm is open
    assert not dataset_comm._closed

    # TODO: test dataset viewer functionality here once it's ready

    # No messages are sent over the environment comm
    assert env_comm.messages == []


def test_handle_view_error(env_comm: DummyComm) -> None:
    msg = {"content": {"data": {"msg_type": "view", "path": ["x"]}}}
    env_comm.handle_msg(msg)

    # An error message is sent
    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "error",
                "message": "Cannot find variable at '['x']' to inspect",
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]


def test_handle_unknown_message_type(env_comm: DummyComm) -> None:
    msg = {"content": {"data": {"msg_type": "unknown_msg_type"}}}
    env_comm.handle_msg(msg)

    assert env_comm.messages == [
        {
            "data": {
                "msg_type": "error",
                "message": "Unknown message type 'unknown_msg_type'",
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        },
    ]


def test_shutdown(env_service: EnvironmentService) -> None:
    # Double-check that the comm is not yet closed
    env_comm = env_service.env_comm
    assert env_comm is not None
    assert not env_comm._closed

    env_service.shutdown()

    # Comm is closed
    assert env_comm._closed
