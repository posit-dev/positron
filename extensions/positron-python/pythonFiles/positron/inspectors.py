#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#
from __future__ import annotations

import copy
import datetime
import inspect
import json
import logging
import numbers
import sys
import types
import uuid
from abc import ABC, abstractmethod
from collections.abc import (
    Mapping,
    MutableMapping,
    MutableSequence,
    MutableSet,
    Sequence,
    Set,
)
from typing import (
    TYPE_CHECKING,
    Any,
    Callable,
    Collection,
    Dict,
    FrozenSet,
    Generic,
    Hashable,
    List,
    Optional,
    Protocol,
    Sized,
    Tuple,
    Type,
    TypeVar,
    Union,
    cast,
)

from .dataviewer import DataColumn, DataSet
from .third_party import np_, pd_, torch_
from .utils import JsonData, get_qualname, not_none, pretty_format

if TYPE_CHECKING:
    import numpy as np
    import pandas as pd
    import polars as pl
    import torch

# General display settings
MAX_ITEMS: int = 10000
MAX_CHILDREN: int = 100
TRUNCATE_AT: int = 1024
PRINT_WIDTH: int = 100

# Array-specific display settings
ARRAY_THRESHOLD = 20
ARRAY_EDGEITEMS = 9

logger = logging.getLogger(__name__)

#
# Base inspector
#

T = TypeVar("T")
T_co = TypeVar("T_co", covariant=True)


class Summarizer(Protocol[T_co]):
    def __call__(self, key: Any, value: Any) -> Optional[T_co]:
        ...


class PositronInspector(Generic[T]):
    """
    Base inspector for any type
    """

    def get_display_name(self, key: str) -> str:
        return str(key)

    def get_display_value(
        self,
        value: T,
        print_width: Optional[int] = PRINT_WIDTH,
        truncate_at: int = TRUNCATE_AT,
    ) -> Tuple[str, bool]:
        return pretty_format(value, print_width, truncate_at)

    def get_display_type(self, value: T) -> str:
        type_name = type(value).__name__

        if isinstance(value, Sized):
            length = self.get_length(value)
            return f"{type_name} [{length}]"

        return type_name

    def get_kind(self, value: T) -> str:
        return _get_kind(value)

    def get_type_info(self, value: T) -> str:
        return get_qualname(type(value))

    def get_access_key(self, key: Any) -> str:
        return encode_access_key(key)

    def get_length(self, value: T) -> int:
        return len(value) if isinstance(value, Sized) else 0

    def get_size(self, value: T) -> int:
        return sys.getsizeof(value)

    def has_children(self, value: T) -> bool:
        return self.get_length(value) > 0

    def has_child(self, value: T, access_key: str) -> bool:
        return False

    def get_child(self, value: T, access_key: str) -> Any:
        raise TypeError(f"get_child() is not implemented for type: {type(value)}")

    def summarize_children(
        self,
        value: T,
        summarizer: Summarizer[T_co],
    ) -> List[T_co]:
        return []

    def has_viewer(self, value: T) -> bool:
        return False

    def is_snapshottable(self, value: T) -> bool:
        return False

    def equals(self, value1: T, value2: T) -> bool:
        return value1 == value2

    def copy(self, value: T) -> T:
        return copy.copy(value)

    def to_dataset(self, value: T, title: str) -> DataSet:
        raise TypeError(f"Type {type(value)} is not supported by `View()`.")

    def to_html(self, value: T) -> str:
        return repr(value)

    def to_plaintext(self, value: T) -> str:
        return repr(value)

    def to_json(self, value: T) -> JsonData:
        return dict(type=self.type_to_json(value), data=self.value_to_json(value))

    def type_to_json(self, value: T) -> str:
        return self.get_type_info(value)

    def value_to_json(self, value: T) -> JsonData:
        raise NotImplementedError(
            f"value_to_json() is not implemented for this type. type: {type(value)}"
        )

    def from_json(self, json_data: JsonData) -> T:
        if not isinstance(json_data, dict):
            raise ValueError(f"Expected json_data to be dict, got {json_data}")

        if not isinstance(json_data["type"], str):
            raise ValueError(f"Expected json_data['type'] to be str, got {json_data['type']}")

        # TODO(pyright): cast shouldn't be necessary, recheck in a future version of pyright
        return self.value_from_json(cast(str, json_data["type"]), json_data["data"])

    def value_from_json(self, type_name: str, data: JsonData) -> T:
        raise NotImplementedError(
            f"value_from_json() is not implemented for this type. type_name: {type_name}, data: {data}"
        )


#
# Scalars
#


class BooleanInspector(PositronInspector[bool]):
    def get_kind(self, value: bool) -> str:
        return "boolean"

    def value_to_json(self, value: bool) -> JsonData:
        return value

    def value_from_json(self, type_name: str, data: JsonData) -> bool:
        if not isinstance(data, bool):
            raise ValueError(f"Expected data to be bool, got {data}")

        return data


class BytesInspector(PositronInspector[bytes]):
    def get_display_value(
        self, value: bytes, print_width: Optional[int] = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        # Ignore print_width for strings
        return super().get_display_value(value, None, truncate_at)

    def get_kind(self, value: bytes) -> str:
        return "bytes"

    def has_children(self, value: bytes) -> bool:
        return False

    def value_to_json(self, value: bytes) -> str:
        return value.decode()

    def value_from_json(self, type_name: str, data: JsonData) -> bytes:
        if not isinstance(data, str):
            raise ValueError(f"Expected data to be str, got {data}")

        return data.encode()


class FunctionInspector(PositronInspector[Callable]):
    def get_display_value(
        self,
        value: Callable,
        print_width: Optional[int] = PRINT_WIDTH,
        truncate_at: int = TRUNCATE_AT,
    ) -> Tuple[str, bool]:
        if callable(value):
            sig = inspect.signature(value)
        else:
            sig = "()"
        return (f"{value.__qualname__}{sig}", False)

    def get_kind(self, value: Callable) -> str:
        return "function"


class NumberInspector(PositronInspector[numbers.Number]):
    def get_kind(self, value: numbers.Number) -> str:
        return "number"

    def type_to_json(self, value: numbers.Number) -> str:
        # Note that our serialization of numbers is lossy, since for example `numpy.int8(0)` would
        # be serialized as `int`. This is fine for our purposes, since `numpy.int8(0)` and `int(0)`
        # can be used interchangeably as keys in a dictionary.
        if isinstance(value, numbers.Integral):
            return "int"
        if isinstance(value, numbers.Real):
            return "float"
        if isinstance(value, numbers.Complex):
            return "complex"
        raise NotImplementedError(
            f"type_to_json() is not implemented for this type. type: {type(value)}"
        )

    def value_to_json(self, value: numbers.Number) -> JsonData:
        if isinstance(value, numbers.Integral):
            return int(value)
        if isinstance(value, numbers.Real):
            return float(value)
        if isinstance(value, numbers.Complex):
            return str(value)
        return super().value_to_json(value)

    def value_from_json(self, type_name: str, data: JsonData) -> numbers.Number:
        if type_name == "int":
            if not isinstance(data, numbers.Integral):
                raise ValueError(f"Expected data to be int, got {data}")
            return data

        if type_name == "float":
            if not isinstance(data, numbers.Real):
                raise ValueError(f"Expected data to be float, got {data}")
            return data

        if type_name == "complex":
            if not isinstance(data, str):
                raise ValueError(f"Expected data to be str, got {data}")
            return cast(numbers.Number, complex(data))

        return super().value_from_json(type_name, data)


class StringInspector(PositronInspector[str]):
    def get_display_value(
        self, value: str, print_width: Optional[int] = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        # Ignore print_width for strings
        display_value, is_truncated = super().get_display_value(value, None, truncate_at)

        # Use repr() to show quotes around strings
        return repr(display_value), is_truncated

    def get_display_type(self, value: str) -> str:
        # Don't include the length for strings
        return type(value).__name__

    def get_kind(self, value: str) -> str:
        return "string"

    def has_children(self, value: str) -> bool:
        return False

    def value_to_json(self, value: str) -> JsonData:
        return value

    def value_from_json(self, type_name: str, data: JsonData) -> str:
        if not isinstance(data, str):
            raise ValueError(f"Expected data to be str, got {data}")

        return data


Timestamp = TypeVar("Timestamp", datetime.datetime, "pd.Timestamp")


class _BaseTimestampInspector(PositronInspector[Timestamp], ABC):
    CLASS: Type[Timestamp]

    @abstractmethod
    def value_from_isoformat(self, string: str) -> Timestamp:
        pass

    def value_to_json(self, value: Timestamp) -> JsonData:
        return value.isoformat()

    def value_from_json(self, type_name: str, data: JsonData) -> Timestamp:
        if not isinstance(data, str):
            raise ValueError(f"Expected data to be str, got {data}")

        return self.value_from_isoformat(data)


class DatetimeInspector(_BaseTimestampInspector[datetime.datetime]):
    CLASS_QNAME = "datetime.datetime"

    def value_from_isoformat(self, string: str) -> datetime.datetime:
        return datetime.datetime.fromisoformat(string)


class PandasTimestampInspector(_BaseTimestampInspector["pd.Timestamp"]):
    CLASS_QNAME = "pandas._libs.tslibs.timestamps.Timestamp"

    def value_from_isoformat(self, string: str) -> pd.Timestamp:
        return not_none(pd_).Timestamp.fromisoformat(string)


#
# Collections
#

CollectionT = Union[range, FrozenSet, Sequence, Set, Tuple]
CT = TypeVar("CT", CollectionT, "np.ndarray", "torch.Tensor")


class _BaseCollectionInspector(PositronInspector[CT], ABC):
    def get_kind(self, value: CT) -> str:
        return "collection"

    def has_children(self, value: CT) -> bool:
        # For ranges, we don't visualize the children as they're
        # implied as a contiguous set of integers in a range.
        # For sets, we don't visualize the children as they're
        # not subscriptable objects.
        if isinstance(value, (range, Set, FrozenSet)):
            return False

        return super().has_children(value)

    def has_child(self, value: CT, access_key: str) -> bool:
        return decode_access_key(access_key) < self.get_length(value)

    def get_child(self, value: CT, access_key: str) -> Any:
        # Don't allow indexing into ranges or sets.
        if isinstance(value, (range, Set, FrozenSet)):
            raise TypeError(f"get_child() is not implemented for type: {type(value)}")

        return value[decode_access_key(access_key)]

    def summarize_children(
        self,
        value: CT,
        summarizer: Summarizer[T_co],
    ) -> List[T_co]:
        # Treat collection items as children, with the index as the name
        children: List[T_co] = []
        for i, item in enumerate(value):
            if len(children) >= MAX_CHILDREN:
                break

            summary = summarizer(i, item)
            if summary is not None:
                children.append(summary)

        return children


# We don't use typing.Sequence here since it includes mappings,
# for which we have a separate inspector.


class CollectionInspector(_BaseCollectionInspector[CollectionT]):
    def get_display_type(self, value: CollectionT) -> str:
        # Display length for various collections and maps
        # using the Python notation for the type
        type_name = type(value).__name__
        length = self.get_length(value)

        if isinstance(value, Set):
            return f"{type_name} {{{length}}}"
        elif isinstance(value, tuple):
            return f"{type_name} ({length})"
        else:
            return f"{type_name} [{length}]"

    def is_snapshottable(self, value: CollectionT) -> bool:
        return isinstance(value, (MutableSequence, MutableSet))

    def value_to_json(self, value: CollectionT) -> JsonData:
        if isinstance(value, range):
            return {"start": value.start, "stop": value.stop, "step": value.step}

        return super().value_to_json(value)

    def value_from_json(self, type_name: str, data: JsonData) -> CollectionT:
        if type_name == "range":
            if not isinstance(data, dict):
                raise ValueError(f"Expected data to be dict, got {data}")

            if not isinstance(data["start"], int):
                raise ValueError(f"Expected data['start'] to be int, got {data['start']}")

            if not isinstance(data["stop"], int):
                raise ValueError(f"Expected data['stop'] to be int, got {data['stop']}")

            if not isinstance(data["step"], int):
                raise ValueError(f"Expected data['step'] to be int, got {data['step']}")

            # TODO(pyright): cast shouldn't be necessary, recheck in a future version of pyright
            return range(cast(int, data["start"]), cast(int, data["stop"]), cast(int, data["step"]))

        return super().value_from_json(type_name, data)


Array = TypeVar("Array", "np.ndarray", "torch.Tensor")


class _BaseArrayInspector(_BaseCollectionInspector[Array], ABC):
    def get_kind(self, value: Array) -> str:
        return "collection" if value.ndim > 0 else "number"

    def get_display_type(self, value: Array) -> str:
        display_type = str(value.dtype)

        # Include shape information, only if it's not a scalar
        shape = value.shape
        if value.ndim == 1:
            # Remove the trailing comma for 1D arrays
            display_type = f"{display_type} ({shape[0]})"
        elif value.ndim != 0:
            display_type = f"{display_type} {tuple(shape)}"

        # Prepend the module name if it's not already there, to distinguish different types of
        # arrays e.g. numpy versus pytorch
        module = type(value).__module__
        if not display_type.startswith(module):
            display_type = f"{module}.{display_type}"

        return display_type

    def get_length(self, value: Array) -> int:
        return value.shape[0] if value.ndim > 0 else 0

    def is_snapshottable(self, value: Array) -> bool:
        return True


class NumpyNdarrayInspector(_BaseArrayInspector["np.ndarray"]):
    CLASS_QNAME = "numpy.ndarray"

    def get_display_value(
        self,
        value: np.ndarray,
        print_width: Optional[int] = PRINT_WIDTH,
        truncate_at: int = TRUNCATE_AT,
    ) -> Tuple[str, bool]:
        return (
            not_none(np_).array2string(
                value,
                max_line_width=print_width,
                threshold=ARRAY_THRESHOLD,
                edgeitems=ARRAY_EDGEITEMS,
                separator=",",
            ),
            True,
        )

    def equals(self, value1: np.ndarray, value2: np.ndarray) -> bool:
        return not_none(np_).array_equal(value1, value2)

    def copy(self, value: np.ndarray) -> np.ndarray:
        return value.copy()


class TorchTensorInspector(_BaseArrayInspector["torch.Tensor"]):
    CLASS_QNAME = "torch.Tensor"

    def get_display_value(
        self,
        value: torch.Tensor,
        print_width: Optional[int] = PRINT_WIDTH,
        truncate_at: int = TRUNCATE_AT,
    ) -> Tuple[str, bool]:
        # NOTE:
        # Once https://github.com/pytorch/pytorch/commit/e03800a93af55ef61f2e610d65ac7194c0614edc
        # is in a stable version we can use it to temporarily set print options
        torch = not_none(torch_)

        new_options = {
            "threshold": ARRAY_THRESHOLD,
            "edgeitems": ARRAY_EDGEITEMS,
            "linewidth": print_width,
        }
        options_obj = torch._tensor_str.PRINT_OPTS
        original_options = {k: getattr(options_obj, k) for k in new_options}

        torch.set_printoptions(**new_options)

        display_value = str(value)
        # Strip the surrounding `tensor(...)`
        display_value = display_value[len("tensor(") : -len(")")]

        torch.set_printoptions(**original_options)

        return display_value, True

    def equals(self, value1: torch.Tensor, value2: torch.Tensor) -> bool:
        return not_none(torch_).equal(value1, value2)

    def copy(self, value: torch.Tensor) -> torch.Tensor:
        # Detach the tensor from any existing computation graphs to avoid gradients propagating
        # through them.
        # TODO: This creates a completely new tensor using new memory. Is there a more
        #       memory-efficient way to do this?
        return value.detach().clone()


#
# Maps
#


MT = TypeVar("MT", Mapping, "pd.DataFrame", "pl.DataFrame", "pd.Series", "pl.Series", "pd.Index")


class _BaseMapInspector(PositronInspector[MT], ABC):
    def get_kind(self, value: MT) -> str:
        return "map"

    @abstractmethod
    def get_keys(self, value: MT) -> Collection[Any]:
        pass

    def has_child(self, value: MT, access_key: str) -> bool:
        return decode_access_key(access_key) in self.get_keys(value)

    def get_child(self, value: MT, access_key: str) -> Any:
        return value[decode_access_key(access_key)]

    def summarize_children(self, value: MT, summarizer: Summarizer[T_co]) -> List[T_co]:
        children: List[T_co] = []

        for key in self.get_keys(value):
            if len(children) >= MAX_CHILDREN:
                break

            child_value = value[key]
            summary = summarizer(key, child_value)
            if summary is not None:
                children.append(summary)

        return children


class MapInspector(_BaseMapInspector[Mapping]):
    def get_keys(self, value: Mapping) -> Collection[Any]:
        return value.keys()

    def is_snapshottable(self, value: Mapping) -> bool:
        return isinstance(value, MutableMapping)


Column = TypeVar("Column", "pd.Series", "pl.Series", "pd.Index")


class BaseColumnInspector(_BaseMapInspector[Column], ABC):
    def get_child(self, value: Column, access_key: str) -> Any:
        return value[decode_access_key(access_key)]

    def get_display_type(self, value: Column) -> str:
        return f"{value.dtype} [{self.get_length(value)}]"

    def get_display_value(
        self,
        value: Column,
        print_width: Optional[int] = PRINT_WIDTH,
        truncate_at: int = TRUNCATE_AT,
    ) -> Tuple[str, bool]:
        # TODO(pyright): cast shouldn't be necessary, recheck in a future version of pyright
        display_value = str(cast(Column, value[:MAX_CHILDREN]).to_list())
        return (display_value, True)

    def to_data_column(self, value: Column, name: str) -> DataColumn:
        type_name = type(value).__name__
        return DataColumn(name=name, type=type_name, data=value.to_list())


class PandasSeriesInspector(BaseColumnInspector["pd.Series"]):
    CLASS_QNAME = "pandas.core.series.Series"

    def get_keys(self, value: pd.Series) -> Collection[Any]:
        return value.index

    def equals(self, value1: pd.Series, value2: pd.Series) -> bool:
        return value1.equals(value2)

    def copy(self, value: pd.Series) -> pd.Series:
        return value.copy()

    def to_html(self, value: pd.Series) -> str:
        # TODO: Support HTML
        return self.to_plaintext(value)

    def to_plaintext(self, value: pd.Series) -> str:
        return value.to_csv(path_or_buf=None, sep="\t")


class PandasIndexInspector(BaseColumnInspector["pd.Index"]):
    CLASS_QNAME = [
        "pandas.core.indexes.base.Index",
        "pandas.core.indexes.datetimes.DatetimeIndex",
        "pandas.core.indexes.range.RangeIndex",
        "pandas.core.indexes.multi.MultiIndex",
    ]

    def get_display_value(
        self,
        value: pd.Index,
        print_width: Optional[int] = PRINT_WIDTH,
        truncate_at: int = TRUNCATE_AT,
    ) -> Tuple[str, bool]:
        # RangeIndexes don't need to be truncated.
        if isinstance(value, not_none(pd_).RangeIndex):
            return str(value), False

        return super().get_display_value(value, print_width, truncate_at)

    def has_children(self, value: pd.Index) -> bool:
        # For ranges, we don't visualize the children as they're
        # implied as a contiguous set of integers in a range.
        if isinstance(value, not_none(pd_).RangeIndex):
            return False

        return super().has_children(value)

    def get_keys(self, value: pd.Index) -> Collection[Any]:
        return range(len(value))

    def equals(self, value1: pd.Index, value2: pd.Index) -> bool:
        return value1.equals(value2)

    def copy(self, value: pd.Index) -> pd.Index:
        return value.copy()

    def to_html(self, value: pd.Index) -> str:
        # TODO: Support HTML
        return self.to_plaintext(value)

    def to_plaintext(self, value: pd.Index) -> str:
        return value.to_series().to_csv(path_or_buf=None, sep="\t")


class PolarsSeriesInspector(BaseColumnInspector["pl.Series"]):
    CLASS_QNAME = [
        "polars.series.series.Series",
        "polars.internals.series.series.Series",
    ]

    def get_keys(self, value: pl.Series) -> Collection[Any]:
        return range(len(value))

    def equals(self, value1: pl.Series, value2: pl.Series) -> bool:
        return value1.series_equal(value2)

    def copy(self, value: pl.Series) -> pl.Series:
        return value.clone()

    def to_html(self, value: pl.Series) -> str:
        # TODO: Support HTML
        return self.to_plaintext(value)

    def to_plaintext(self, value: pl.Series) -> str:
        return value.to_frame().write_csv(file=None, separator="\t")


Table = TypeVar("Table", "pd.DataFrame", "pl.DataFrame")


class BaseTableInspector(_BaseMapInspector[Table], Generic[Table, Column], ABC):
    """
    Base inspector for tabular data
    """

    def get_display_type(self, value: Table) -> str:
        type_name = type(value).__name__
        shape = value.shape
        return f"{type_name} [{shape[0]}x{shape[1]}]"

    def get_kind(self, value: Table) -> str:
        return "table"

    def get_length(self, value: Table) -> int:
        return value.shape[0]

    def get_keys(self, value: Table) -> Collection[Any]:
        return value.columns

    @abstractmethod
    def get_column_inspector(self) -> BaseColumnInspector[Column]:
        pass

    def has_viewer(self, value: Table) -> bool:
        return True

    def is_snapshottable(self, value: Table) -> bool:
        return True

    def to_dataset(self, value: Table, title: str) -> DataSet:
        column_inspector = self.get_column_inspector()

        columns: List[DataColumn] = []
        for column_name in self.get_keys(value):
            column_value = cast(Column, value[column_name])
            data_column = column_inspector.to_data_column(column_value, str(column_name))
            columns.append(data_column)
        rowCount = value.shape[0]

        return DataSet(id=str(uuid.uuid4()), title=title, columns=columns, rowCount=rowCount)


#
# Custom inspectors for specific types
#


class PandasDataFrameInspector(BaseTableInspector["pd.DataFrame", "pd.Series"]):
    CLASS_QNAME = "pandas.core.frame.DataFrame"

    def get_display_value(
        self,
        value: pd.DataFrame,
        print_width: Optional[int] = PRINT_WIDTH,
        truncate_at: int = TRUNCATE_AT,
    ) -> Tuple[str, bool]:
        display_value = get_qualname(value)
        if hasattr(value, "shape"):
            shape = value.shape
            display_value = f"[{shape[0]} rows x {shape[1]} columns] {display_value}"

        return (display_value, True)

    def get_column_inspector(self) -> PandasSeriesInspector:
        return _PANDAS_SERIES_INSPECTOR

    def equals(self, value1: pd.DataFrame, value2: pd.DataFrame) -> bool:
        return value1.equals(value2)

    def copy(self, value: pd.DataFrame) -> pd.DataFrame:
        return value.copy()

    def to_html(self, value: pd.DataFrame) -> str:
        return value.to_html()

    def to_plaintext(self, value: pd.DataFrame) -> str:
        return value.to_csv(path_or_buf=None, sep="\t")


class PolarsDataFrameInspector(BaseTableInspector["pl.DataFrame", "pl.Series"]):
    CLASS_QNAME = [
        "polars.dataframe.frame.DataFrame",
        "polars.internals.dataframe.frame.DataFrame",
    ]

    def get_display_value(
        self,
        value: pl.DataFrame,
        print_width: Optional[int] = PRINT_WIDTH,
        truncate_at: int = TRUNCATE_AT,
    ) -> Tuple[str, bool]:
        qualname = get_qualname(value)
        shape = value.shape
        display_value = f"[{shape[0]} rows x {shape[1]} columns] {qualname}"
        return (display_value, True)

    def get_column_inspector(self) -> PolarsSeriesInspector:
        return _POLARS_SERIES_INSPECTOR

    def equals(self, value1: pl.DataFrame, value2: pl.DataFrame) -> bool:
        return value1.frame_equal(value2)

    def copy(self, value: pl.DataFrame) -> pl.DataFrame:
        return value.clone()

    def to_html(self, value: pl.DataFrame) -> str:
        return value._repr_html_()

    def to_plaintext(self, value: pl.DataFrame) -> str:
        return value.write_csv(file=None, separator="\t")


_PANDAS_SERIES_INSPECTOR = PandasSeriesInspector()
_POLARS_SERIES_INSPECTOR = PolarsSeriesInspector()
INSPECTORS: Dict[str, PositronInspector] = {
    PandasDataFrameInspector.CLASS_QNAME: PandasDataFrameInspector(),
    PandasSeriesInspector.CLASS_QNAME: _PANDAS_SERIES_INSPECTOR,
    **dict.fromkeys(PandasIndexInspector.CLASS_QNAME, PandasIndexInspector()),
    PandasTimestampInspector.CLASS_QNAME: PandasTimestampInspector(),
    NumpyNdarrayInspector.CLASS_QNAME: NumpyNdarrayInspector(),
    TorchTensorInspector.CLASS_QNAME: TorchTensorInspector(),
    **dict.fromkeys(PolarsDataFrameInspector.CLASS_QNAME, PolarsDataFrameInspector()),
    **dict.fromkeys(PolarsSeriesInspector.CLASS_QNAME, _POLARS_SERIES_INSPECTOR),
    DatetimeInspector.CLASS_QNAME: DatetimeInspector(),
    "boolean": BooleanInspector(),
    "bytes": BytesInspector(),
    "collection": CollectionInspector(),
    "function": FunctionInspector(),
    "map": MapInspector(),
    "number": NumberInspector(),
    "string": StringInspector(),
}

#
# Helper functions
#


def get_inspector(value: T) -> PositronInspector[T]:
    # Look for a specific inspector by qualified classname
    qualname = get_qualname(value)
    inspector = INSPECTORS.get(qualname, None)

    if inspector is None:
        # Otherwise, look for an inspector by kind
        kind = _get_kind(value)
        inspector = INSPECTORS.get(kind, None)

    # Otherwise, default to generic inspector
    if inspector is None:
        inspector = PositronInspector()

    return inspector


def _get_kind(value: Any) -> str:
    if isinstance(value, str):
        return "string"
    elif isinstance(value, bool):
        return "boolean"
    elif isinstance(value, numbers.Number):
        return "number"
    elif isinstance(value, Mapping):
        return "map"
    elif isinstance(value, (bytes, bytearray, memoryview)):
        return "bytes"
    elif isinstance(value, (Sequence, Set)):
        return "collection"
    elif isinstance(value, (types.FunctionType, types.MethodType)):
        return "function"
    elif value is not None:
        return "other"
    else:
        return "empty"


def encode_access_key(key: Any) -> str:
    # If it's not hashable, raise an error.
    if not isinstance(key, Hashable):
        raise TypeError(f"Key {key} is not hashable.")

    # If it's a blank string, return it as-is.
    if isinstance(key, str) and key == "":
        return key

    # Get the key's inspector and serialize the key.
    inspector = get_inspector(key)
    json_data = inspector.to_json(key)
    # Pass separators to json.dumps to remove whitespace after "," and ":".
    return json.dumps(json_data, separators=(",", ":"))


# Since access keys are serialized to JSON, we can't use get_inspector to find the inspector
# corresponding to a serialized access key. We instead use the key's type's qualname, but need this
# dict to map known and supported qualnames to keys that are accepted by get_inspector.
_ACCESS_KEY_QUALNAME_TO_INSPECTOR_KEY: Dict[str, str] = {
    "int": "number",
    "float": "number",
    "complex": "number",
    "bool": "boolean",
    "str": "string",
    "range": "collection",
}


def decode_access_key(access_key: str) -> Any:
    # If it's a blank string, return it as-is.
    if access_key == "":
        return access_key

    # Deserialize the access key.
    json_data: JsonData = json.loads(access_key)

    # Validate the json data structure.
    if (
        not isinstance(json_data, dict)
        or not isinstance(json_data["type"], str)
        or not isinstance(json_data["data"], (dict, list, str, int, float, bool, type(None)))
    ):
        raise ValueError(f"Unexpected json data structure: {json_data}")

    # Get the inspector for this type.
    # TODO(pyright): cast shouldn't be necessary, recheck in a future version of pyright
    type_name = cast(str, json_data["type"])
    inspector_key = _ACCESS_KEY_QUALNAME_TO_INSPECTOR_KEY.get(type_name, type_name)
    inspector = INSPECTORS.get(inspector_key, PositronInspector())

    # Reconstruct the access key's original object using the deserialized JSON data.
    return inspector.from_json(json_data)
