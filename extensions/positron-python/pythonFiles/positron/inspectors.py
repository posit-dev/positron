#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#
from __future__ import annotations

import copy
import inspect
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
    Any,
    Callable,
    Dict,
    FrozenSet,
    Generic,
    Iterable,
    List,
    Optional,
    Sized,
    Tuple,
    TYPE_CHECKING,
    TypeVar,
    Union,
)

from .dataviewer import DataColumn, DataSet
from .utils import get_qualname, pretty_format

if TYPE_CHECKING:
    import numpy as np
    import pandas as pd
    import polars as pl
    import torch

    from .environment import EnvironmentVariable

# General display settings
MAX_ITEMS: int = 10000
MAX_CHILDREN: int = 100
TRUNCATE_AT: int = 1024
PRINT_WIDTH: int = 100

# Array-specific display settings
ARRAY_THRESHOLD = 20
ARRAY_EDGEITEMS = 9

# Marker used to track if our default object was returned from a
# conditional property lookup
__POSITRON_DEFAULT__ = object()

logger = logging.getLogger(__name__)

#
# Base inspector
#

T = TypeVar("T")


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

    def get_access_key(self, name: str) -> str:
        return self.get_display_name(name)

    def get_length(self, value: T) -> int:
        return len(value) if isinstance(value, Sized) else 0

    def get_size(self, value: T) -> int:
        return sys.getsizeof(value)

    def has_children(self, value: T) -> bool:
        return self.get_length(value) > 0

    def has_child(self, value: T, child_name: str) -> bool:
        return False

    def get_child(self, value: T, child_name: str) -> Any:
        return None

    def summarize_children(
        self,
        value: T,
        summarizer: Callable[[str, T], Optional[EnvironmentVariable]],
    ) -> List[EnvironmentVariable]:
        return []

    def has_viewer(self, value: T) -> bool:
        return False

    def is_snapshottable(self, value: T) -> bool:
        return False

    def equals(self, value1: T, value2: T) -> bool:
        return value1 == value2

    def copy(self, value: T) -> T:
        return copy.copy(value)

    def to_dataset(self, value: T, title: str) -> Optional[DataSet]:
        raise TypeError(f"Type {type(value)} is not supported by `View()`.")

    def to_html(self, value: T) -> str:
        return repr(value)

    def to_plaintext(self, value: T) -> str:
        return repr(value)


#
# Scalars
#


class BooleanInspector(PositronInspector[bool]):
    def get_kind(self, value: bool) -> str:
        return "boolean"


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


#
# Collections
#

CT = TypeVar("CT", bound=Iterable)


class _BaseCollectionInspector(PositronInspector[CT], ABC):
    def get_kind(self, value: CT) -> str:
        return "collection"

    def has_child(self, value: CT, child_name: str) -> bool:
        return int(child_name) < self.get_length(value)

    def summarize_children(
        self,
        value: CT,
        summarizer: Callable[[str, Any], Optional[EnvironmentVariable]],
    ) -> List[EnvironmentVariable]:
        # Treat collection items as children, with the index as the name
        children: List[EnvironmentVariable] = []
        for i, item in enumerate(value):
            if len(children) >= MAX_CHILDREN:
                break

            summary = summarizer(str(i), item)
            if summary is not None:
                children.append(summary)

        return children


# We don't use typing.Sequence here since it includes mappings,
# for which we have a separate inspector.
Collection = Union[range, FrozenSet, Sequence, Set, Tuple]


class CollectionInspector(_BaseCollectionInspector[Collection]):
    def get_display_type(self, value: Collection) -> str:
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

    def has_children(self, value: Collection) -> bool:
        # For ranges, we don't visualize the children as they're
        # implied as a contiguous set of integers in a range.
        # For sets, we don't visualize the children as they're
        # not subscriptable objects.
        if isinstance(value, (frozenset, range, set)):
            return False

        return super().has_children(value)

    def get_child(self, value: Collection, child_name: str) -> Any:
        # Don't allow indexing into sets.
        if isinstance(value, (Set, FrozenSet)):
            return None
        return value[int(child_name)]

    def is_snapshottable(self, value: Collection) -> bool:
        return isinstance(value, (MutableSequence, MutableSet))


Column = TypeVar("Column", "pd.Series", "pl.Series")


class _BaseColumnInspector(_BaseCollectionInspector[Column]):
    def get_display_value(
        self,
        value: pd.Series,
        print_width: Optional[int] = PRINT_WIDTH,
        truncate_at: int = TRUNCATE_AT,
    ) -> Tuple[str, bool]:
        display_value = str(value.head(MAX_CHILDREN).to_list())
        return (display_value, True)

    def summarize_children(
        self, value: Column, summarizer: Callable[[str, Any], Optional[EnvironmentVariable]]
    ) -> List[EnvironmentVariable]:
        children: List[EnvironmentVariable] = []

        # Only include the first MAX_CHILDREN columns in the summary.
        items = value.head(MAX_CHILDREN).to_list()
        # TODO: We should use the index of the series as the access key.
        for i, item in enumerate(items):
            summary = summarizer(str(i), item)
            if summary is None:
                logger.warning(f"Failed to summarize column {value.name}")
            else:
                children.append(summary)

        return children

    def to_data_column(self, value: Column, name: str) -> DataColumn:
        # Use BaseModel.construct to avoid validation due to performance issues.
        # TODO: Revisit __init__ and the new SkipValidation type when we upgrade to pydantic 2.0
        # since the performance gap has been considerably reduced.
        type_name = type(value).__name__
        return DataColumn.construct(name=name, type=type_name, data=value.to_list())


class PandasSeriesInspector(_BaseColumnInspector["pd.Series"]):
    CLASS_QNAME = "pandas.core.series.Series"

    def get_child(self, value: pd.Series, child_name: str) -> Any:
        # TODO: We should use the index of the series as the access key.
        return value.iat[int(child_name)]

    def equals(self, value1: pd.Series, value2: pd.Series) -> bool:
        return value1.equals(value2)

    def copy(self, value: pd.Series) -> pd.Series:
        return value.copy()

    def to_html(self, value: pd.Series) -> str:
        # TODO: Support HTML
        return self.to_plaintext(value)

    def to_plaintext(self, value: pd.Series) -> str:
        return value.to_csv(path_or_buf=None, sep="\t")


class PolarsSeriesInspector(_BaseColumnInspector["pl.Series"]):
    CLASS_QNAME = [
        "polars.series.series.Series",
        "polars.internals.series.series.Series",
    ]

    def get_child(self, value: pl.Series, child_name: str) -> Any:
        return value[int(child_name)]

    def equals(self, value1: pl.Series, value2: pl.Series) -> bool:
        return value1.series_equal(value2)

    def copy(self, value: pl.Series) -> pl.Series:
        return value.clone()

    def to_html(self, value: pl.Series) -> str:
        # TODO: Support HTML
        return self.to_plaintext(value)

    def to_plaintext(self, value: pl.Series) -> str:
        return value.to_frame().write_csv(file=None, separator="\t")


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
        import numpy as np

        return (
            np.array2string(
                value,
                max_line_width=print_width,
                threshold=ARRAY_THRESHOLD,
                edgeitems=ARRAY_EDGEITEMS,
                separator=",",
            ),
            True,
        )

    def equals(self, value1: np.ndarray, value2: np.ndarray) -> bool:
        import numpy as np

        return np.array_equal(value1, value2)

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
        import torch

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
        import torch

        return torch.equal(value1, value2)

    def copy(self, value: torch.Tensor) -> torch.Tensor:
        # Detach the tensor from any existing computation graphs to avoid gradients propagating
        # through them.
        # TODO: This creates a completely new tensor using new memory. Is there a more
        #       memory-efficient way to do this?
        return value.detach().clone()


#
# Maps
#


MT = TypeVar("MT", Mapping, "pd.DataFrame", "pl.DataFrame")


class _BaseMapInspector(PositronInspector[MT]):
    @abstractmethod
    def get_child_names(self, value: MT) -> Iterable[Any]:
        pass

    def has_child(self, value: MT, child_name: Any) -> bool:
        # Try to find an exact match
        if child_name in value:
            return True

        # If we can't get an exact match, try to find a key whose str() matches
        return any(str(key) == child_name for key in self.get_child_names(value))

    def get_child(self, value: MT, child_name: Any) -> Any:
        # Try to find an exact match
        try:
            return value[child_name]
        except KeyError:
            pass

        # If we can't get an exact match, try to find a key whose str() matches
        matches = [key for key in self.get_child_names(value) if str(key) == child_name]
        if matches:
            return value[matches[0]]

        # We couldn't find a match
        return None


class MapInspector(_BaseMapInspector[Mapping]):
    def get_kind(self, value: Mapping) -> str:
        return "map"

    def get_child_names(self, value: Mapping) -> Iterable[Any]:
        return value.keys()

    def is_snapshottable(self, value: Mapping) -> bool:
        return isinstance(value, MutableMapping)

    def summarize_children(
        self, value: Mapping, summarizer: Callable[[str, Any], Optional[EnvironmentVariable]]
    ) -> List[EnvironmentVariable]:
        children: List[EnvironmentVariable] = []

        for key, value in value.items():
            if len(children) >= MAX_CHILDREN:
                break

            summary = summarizer(str(key), value)
            if summary is not None:
                children.append(summary)

        return children


Table = TypeVar("Table", "pd.DataFrame", "pl.DataFrame")


class _BaseTableInspector(_BaseMapInspector[Table], Generic[Table, Column], ABC):
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

    def get_child_names(self, value: Table) -> Iterable[Any]:
        return value.columns

    @abstractmethod
    def get_column_inspector(self) -> _BaseColumnInspector[Column]:
        pass

    def summarize_children(
        self, value: Table, summarizer: Callable[[str, Any], Optional[EnvironmentVariable]]
    ) -> List[EnvironmentVariable]:
        children: List[EnvironmentVariable] = []

        length = self.get_length(value)
        for column_name in self.get_child_names(value):
            # Only include the first MAX_CHILDREN columns in the summary.
            if len(children) >= MAX_CHILDREN:
                break

            column_value = self.get_child(value, column_name)
            summary = summarizer(str(column_name), column_value)
            if summary is None:
                logger.warning(f"Failed to summarize column {column_name} in table")
            else:
                # Override the column's display type to only show the datatype and length.
                summary.display_type = f"{column_value.dtype} [{length}]"

                children.append(summary)

        return children

    def has_viewer(self, value: Table) -> bool:
        return True

    def is_snapshottable(self, value: Table) -> bool:
        return True

    def to_dataset(self, value: Table, title: str) -> DataSet:
        column_inspector = self.get_column_inspector()

        columns: List[DataColumn] = []
        for column_name in self.get_child_names(value):
            column_value = self.get_child(value, column_name)
            data_column = column_inspector.to_data_column(column_value, str(column_name))
            columns.append(data_column)
        rowCount = value.shape[0]

        return DataSet(id=str(uuid.uuid4()), title=title, columns=columns, rowCount=rowCount)


#
# Custom inspectors for specific types
#


class PandasDataFrameInspector(_BaseTableInspector["pd.DataFrame", "pd.Series"]):
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

    def get_column_names(self, value: pd.DataFrame) -> List[Any]:
        return value.columns.tolist()

    def equals(self, value1: pd.DataFrame, value2: pd.DataFrame) -> bool:
        return value1.equals(value2)

    def copy(self, value: pd.DataFrame) -> pd.DataFrame:
        return value.copy()

    def to_html(self, value: pd.DataFrame) -> str:
        return value.to_html()

    def to_plaintext(self, value: pd.DataFrame) -> str:
        return value.to_csv(path_or_buf=None, sep="\t")


class PolarsDataFrameInspector(_BaseTableInspector["pl.DataFrame", "pl.Series"]):
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
    NumpyNdarrayInspector.CLASS_QNAME: NumpyNdarrayInspector(),
    TorchTensorInspector.CLASS_QNAME: TorchTensorInspector(),
    **dict.fromkeys(PolarsDataFrameInspector.CLASS_QNAME, PolarsDataFrameInspector()),
    **dict.fromkeys(PolarsSeriesInspector.CLASS_QNAME, _POLARS_SERIES_INSPECTOR),
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


def get_inspector(value: Any) -> PositronInspector:
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
