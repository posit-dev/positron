#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#
from __future__ import annotations

import copy
import inspect
import logging
import numbers
import pickle
import sys
import types
import uuid
from collections.abc import Mapping, MutableMapping, MutableSequence, MutableSet, Sequence, Set
from typing import Any, Callable, Optional, Tuple, TYPE_CHECKING

from .dataviewer import DataColumn, DataSet
from .utils import get_value_length, get_qualname, pretty_format

if TYPE_CHECKING:
    import numpy as np
    import torch
    from .environment import EnvironmentVariable

# General display settings
MAX_ITEMS: int = 100
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


class PositronInspector:
    """
    Base inspector for any type
    """

    def get_display_name(self, key: Any) -> str:
        return str(key)

    def get_display_value(
        self,
        value: Any,
        print_width: Optional[int] = PRINT_WIDTH,
        truncate_at: Optional[int] = TRUNCATE_AT,
    ) -> Tuple[str, bool]:
        return pretty_format(value, print_width, truncate_at)

    def get_display_type(self, value: Any) -> str:
        if value is None:
            return "NoneType"

        type_name = type(value).__name__
        display_type = type_name

        if isinstance(value, str):
            # For strings, which are also Sequences, we suppress
            # showing the length in the display type
            display_type = type_name
        else:
            # Also display length for various collections and maps
            # using the Python notation for the type
            length = self.get_length(value)

            if isinstance(value, Set):
                display_type = f"{type_name} {{{length}}}"

            elif isinstance(value, tuple):
                display_type = f"{type_name} ({length})"

            elif isinstance(value, (Sequence, Mapping)):
                display_type = f"{type_name} [{length}]"

            elif length > 0:
                display_type = f"{type_name} [{length}]"

        return display_type

    def get_kind(self, value: Any) -> str:
        return _get_kind(value)

    def get_type_info(self, value: Any) -> str:
        return get_qualname(type(value))

    def get_access_key(self, name: Any) -> str:
        return self.get_display_name(name)

    def get_length(self, value: Any) -> int:
        return get_value_length(value)

    def get_size(self, value: Any) -> int:
        return sys.getsizeof(value)

    def has_children(self, value: Any) -> bool:
        return False

    def has_child(self, value: Any, child_name: str) -> bool:
        return False

    def get_child(self, value: Any, child_name: str) -> Any:
        return None

    def summarize_children(
        self, value: Any, summarizer: Callable[[str, Any], Optional[EnvironmentVariable]]
    ) -> list:
        return []

    def has_viewer(self, value: Any) -> bool:
        return False

    def is_snapshottable(self, value: Any) -> bool:
        return False

    def equals(self, value1: Any, value2: Any) -> bool:
        return value1 == value2

    def copy(self, value: Any) -> Any:
        return copy.copy(value)

    def to_dataset(self, value: Any, title: str) -> Optional[DataSet]:
        raise TypeError(f"Type {type(value)} is not supported by `View()`.")

    def to_html(self, value: Any) -> str:
        return repr(value)

    def to_plaintext(self, value: Any) -> str:
        return repr(value)


#
# Inspectors by kind
#


class BooleanInspector(PositronInspector):
    def get_kind(self, value: Any) -> str:
        return "boolean"


class BytesInspector(PositronInspector):
    def get_display_value(
        self, value: Any, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        # Ignore print_width for bytes types
        return pretty_format(value, None, truncate_at)

    def get_kind(self, value: Any) -> str:
        return "bytes"


class CollectionInspector(PositronInspector):
    def get_kind(self, value: Any) -> str:
        return "collection"

    def has_child(self, value: Any, child_name: str) -> bool:
        if isinstance(value, (list, tuple, range)):
            try:
                index = int(child_name)
                return index < self.get_length(value)
            except Exception:
                logger.warning(f"Unable to find child value at '{child_name}'", exc_info=True)

        return False

    def get_child(self, value: Any, child_name: str) -> Any:
        child_value = None

        if isinstance(value, (list, tuple, range)):
            try:
                index = int(child_name)
                child_value = value[index]
            except Exception:
                logger.warning(f"Unable to find child value at '{child_name}'", exc_info=True)

        return child_value

    def has_children(self, value: Any) -> bool:
        # For ranges, we don't visualize the children as they're
        # implied as a contiguous set of integers in a range
        # For sets, we don't visualize the children as they're
        # not subscriptable objects
        if isinstance(value, (frozenset, range, set)):
            return False
        else:
            return self.get_length(value) > 0

    def summarize_children(
        self, value: Any, summarizer: Callable[[str, Any], Optional[EnvironmentVariable]]
    ) -> list:
        # Treat collection items as children, with the index as the name
        children = []
        if isinstance(value, (list, tuple)):
            for i, item in enumerate(value):
                if len(children) >= MAX_ITEMS:
                    break

                summary = summarizer(str(i), item)
                if summary is not None:
                    children.append(summary)

        return children

    def is_snapshottable(self, value: Any) -> bool:
        return isinstance(value, (MutableSequence, MutableSet))


class FunctionInspector(PositronInspector):
    def get_display_value(
        self, value: Any, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        if callable(value):
            sig = inspect.signature(value)
        else:
            sig = "()"
        return (f"{value.__qualname__}{sig}", False)

    def get_kind(self, value: Any) -> str:
        return "function"


class MapInspector(PositronInspector):
    def get_kind(self, value: Any) -> str:
        return "map"

    def has_children(self, value: Any) -> bool:
        return self.get_length(value) > 0

    def has_child(self, value: Any, child_name: str) -> bool:
        if isinstance(value, Mapping):
            map_value = value.get(child_name, __POSITRON_DEFAULT__)
            return map_value is not __POSITRON_DEFAULT__

        return False

    def get_child(self, value: Any, child_name: str) -> Any:
        child_value = None

        if isinstance(value, Mapping):
            map_value = value.get(child_name, __POSITRON_DEFAULT__)
            if map_value is not __POSITRON_DEFAULT__:
                child_value = map_value

        return child_value

    def summarize_children(
        self, value: Any, summarizer: Callable[[str, Any], Optional[EnvironmentVariable]]
    ) -> list:
        children = []

        if isinstance(value, Mapping):
            for key, value in value.items():
                if len(children) >= MAX_ITEMS:
                    break

                summary = summarizer(str(key), value)
                if summary is not None:
                    children.append(summary)

        return children

    def is_snapshottable(self, value: Any) -> bool:
        return isinstance(value, MutableMapping)


class NumberInspector(PositronInspector):
    def get_kind(self, value: Any) -> str:
        return "number"


class StringInspector(PositronInspector):
    def get_display_value(
        self, value: Any, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        # Ignore print_width for strings
        display_value, is_truncated = super().get_display_value(value, None, truncate_at)

        # Use repr() to show quotes around strings
        return repr(display_value), is_truncated

    def get_kind(self, value: Any) -> str:
        return "string"


class TableInspector(PositronInspector):
    """
    Base inspector for tabular data
    """

    def get_kind(self, value: Any) -> str:
        return "table"

    def has_children(self, value: Any) -> bool:
        return self.get_length(value) > 0

    def has_child(self, value: Any, child_name: str) -> bool:
        return child_name in self.get_column_names(value)

    def get_child(self, value: Any, child_name: str) -> Any:
        return self.get_column(value, child_name)

    def get_column_names(self, value: Any) -> list:
        return []

    def get_column(self, value: Any, column_name: str) -> list:
        return []

    def get_column_display_type(self, value: Any, column_name: str) -> str:
        return ""

    def summarize_children(
        self, value: Any, summarizer: Callable[[str, Any], Optional[EnvironmentVariable]]
    ) -> list:
        children = []

        for column_name in self.get_column_names(value):
            column_value = self.get_column(value, column_name)
            column_display_type = self.get_column_display_type(value, column_name)

            summary = summarizer(column_name, column_value)
            if summary is not None:
                summary.display_type = column_display_type
                children.append(summary)

        return children

    def has_viewer(self, value: Any) -> bool:
        return True

    def is_snapshottable(self, value: Any) -> bool:
        return True


#
# Custom inspectors for specific types
#


class PandasDataFrameInspector(TableInspector):
    CLASS_QNAME = "pandas.core.frame.DataFrame"

    def get_display_value(
        self, value: Any, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        display_value = get_qualname(value)

        if hasattr(value, "shape"):
            shape = value.shape
            display_value = f"[{shape[0]} rows x {shape[1]} columns] {display_value}"

        return (display_value, True)

    def get_display_type(self, value: Any) -> str:
        display_type = type(value).__name__

        if hasattr(value, "shape"):
            shape = value.shape
            display_type = f"{display_type} [{shape[0]}x{shape[1]}]"

        return display_type

    def get_length(self, value: Any) -> int:
        return value.shape[0]

    def get_column_names(self, value: Any) -> list:
        try:
            return value.columns.values.tolist()
        except Exception:
            return []

    def get_column(self, value: Any, column_name: str) -> Any:
        try:
            column = value[column_name]
            values = column.values.tolist()
        except Exception:
            values = []
            logger.warning("Unable to get Pandas column: %s", column_name, exc_info=True)

        return values

    def get_column_display_type(self, value: Any, column_name: str) -> str:
        try:
            column = value[column_name]

            # Use dtype information, if we have it
            if hasattr(column, "dtype"):
                column_type = str(column.dtype)
            else:
                column_type = type(column).__name__

            # Include size information, if we have it
            if hasattr(column, "size"):
                size = column.size
            else:
                values = column.values.tolist()
                size = len(values)

            display_type = f"{column_type} [{size}]"
        except Exception:
            display_type = ""
            logger.warning("Unable to get Pandas column type: %s", column_name, exc_info=True)

        return display_type

    def equals(self, value1: Any, value2: Any) -> bool:
        return value1.equals(value2)

    def copy(self, value: Any) -> Any:
        return value.copy()

    def to_dataset(self, value: Any, title: str) -> Optional[DataSet]:
        columns = []
        for column_name in self.get_column_names(value):
            column = value[column_name]
            column_type = type(column).__name__
            column_data = column.values.tolist()
            columns.append(DataColumn(column_name, column_type, column_data))
        rowCount = len(columns[0].get("data"))

        return DataSet(str(uuid.uuid4()), title, columns, rowCount)

    def to_html(self, value: Any) -> str:
        return value.to_html()

    def to_plaintext(self, value: Any) -> str:
        return value.to_csv(path_or_buf=None, sep="\t")


class PandasSeriesInspector(CollectionInspector):
    CLASS_QNAME = "pandas.core.series.Series"

    def get_display_value(
        self, value: Any, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        try:
            display_value = value.to_string(index=False, max_rows=MAX_ITEMS)
            return (display_value, True)
        except Exception:
            logger.warning("Unable to display Pandas Series", exc_info=True)
            display_value = self.get_display_type(value)
            return (display_value, True)

    def get_display_type(self, value: Any) -> str:
        display_type = type(value).__name__
        length = len(value)
        display_type = display_type + f" [{length}]"

        return display_type

    def get_length(self, value: Any) -> int:
        return value.size

    def has_child(self, value: Any, child_name: str) -> bool:
        try:
            index = int(child_name)
            return index < self.get_length(value)
        except Exception:
            logger.warning(f"Unable to find Pandas Series child at '{child_name}'", exc_info=True)

        return False

    def get_child(self, value: Any, child_name: str) -> Any:
        child_value = None

        try:
            index = int(child_name)
            child_value = value.iat[index]
        except Exception:
            logger.warning(f"Unable to find Pandas Series child at '{child_name}'", exc_info=True)

        return child_value

    def summarize_children(
        self, value: Any, summarizer: Callable[[str, Any], Optional[EnvironmentVariable]]
    ) -> list:
        # Treat collection items as children, with the index as the name
        children = []
        try:
            items = value.to_list()
            for i, item in enumerate(items):
                if len(children) >= MAX_ITEMS:
                    break

                summary = summarizer(str(i), item)
                if summary is not None:
                    children.append(summary)
        except Exception:
            logger.warning("Error summarizing Pandas Series children", exc_info=True)

        return children

    def equals(self, value1: Any, value2: Any) -> bool:
        return value1.equals(value2)

    def copy(self, value: Any) -> Any:
        return value.copy()

    def to_html(self, value: Any) -> str:
        # TODO: Support HTML
        return self.to_plaintext(value)

    def to_plaintext(self, value: Any) -> str:
        return value.to_csv(path_or_buf=None, sep="\t")


class PolarsInspector(TableInspector):
    CLASS_QNAME = ["polars.dataframe.frame.DataFrame", "polars.internals.dataframe.frame.DataFrame"]

    def get_display_value(
        self, value: Any, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        display_value = get_qualname(value)

        if hasattr(value, "shape"):
            shape = value.shape
            display_value = f"[{shape[0]} rows x {shape[1]} columns] {display_value}"

        return (display_value, True)

    def get_display_type(self, value: Any) -> str:
        display_type = type(value).__name__

        if hasattr(value, "shape"):
            shape = value.shape
            display_type = f"{display_type} [{shape[0]}x{shape[1]}]"

        return display_type

    def get_length(self, value: Any) -> int:
        return value.shape[0]

    def get_column_names(self, value: Any) -> list:
        try:
            return value.columns
        except Exception:
            return []

    def get_column(self, value: Any, child_name: str) -> Any:
        try:
            column = value.get_column(child_name)
            return column.to_list()
        except Exception:
            logger.warning("Unable to get Polars child: %s", child_name, exc_info=True)
            return []

    def get_column_display_type(self, value: Any, column_name: str) -> str:
        try:
            column = value.get_column(column_name)

            # Use dtype information, if we have it
            if hasattr(column, "dtype"):
                column_type = str(column.dtype)
            else:
                column_type = type(column).__name__

            # Include size information, if we have it
            if hasattr(column, "len"):
                size = column.len()
            else:
                values = column.to_list()
                size = len(values)

            display_type = f"{column_type} [{size}]"
        except Exception:
            logger.warning("Unable to get Polars column type: %s", column_name, exc_info=True)
            display_type = ""

        return display_type

    def equals(self, value1: Any, value2: Any) -> bool:
        return value1.frame_equal(value2)

    def copy(self, value: Any) -> Any:
        return value.clone()

    def to_dataset(self, value: Any, title: str) -> Optional[DataSet]:
        columns = []
        for column_name in self.get_column_names(value):
            column = value.get_column(column_name)
            column_type = type(column).__name__
            column_data = column.to_list()
            columns.append(DataColumn(column_name, column_type, column_data))
        rowCount = len(columns[0].get("data"))

        return DataSet(str(uuid.uuid4()), title, columns, rowCount)

    def to_html(self, value: Any) -> str:
        return value._repr_html_()

    def to_plaintext(self, value: Any) -> str:
        return value.write_csv(file=None, separator="\t")


class NumpyNdarrayInspector(CollectionInspector):
    CLASS_QNAME = "numpy.ndarray"

    def get_kind(self, value: Any) -> str:
        return "collection" if value.ndim > 0 else "number"

    def get_display_value(
        self, value: np.ndarray, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        try:
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
        except Exception:
            logger.warning("Unable to display Ndarray", exc_info=True)
            return (self.get_display_type(value), True)

    def get_display_type(self, value: Any) -> str:
        # Use dtype information, if we have it
        if hasattr(value, "dtype"):
            display_type = str(value.dtype)
        else:
            display_type = type(value).__name__

        # Include shape information
        if value.ndim == 1:
            shape = value.shape
            display_type = f"{display_type} ({shape[0]})"
        # Only include shape information if it's not a scalar
        elif value.ndim != 0:
            display_type = f"{display_type} {tuple(value.shape)}"

        # Prepend the module name if it's not already there, to distinguish different types of
        # arrays e.g. numpy versus pytorch
        module = type(value).__module__
        if not display_type.startswith(module):
            display_type = f"{module}.{display_type}"

        return display_type

    def get_length(self, value: Any) -> int:
        return value.shape[0] if value.ndim > 0 else 0

    def get_column_names(self, value: Any) -> list:
        try:
            dimensions = value.ndim
            columns = range(dimensions)
            return list(map(str, list(columns)))
        except Exception:
            return []

    def has_child(self, value: Any, child_name: str) -> bool:
        try:
            index = int(child_name)
            return index < self.get_length(value)
        except Exception:
            logger.warning(f"Unable to find Numpy ndarray child at '{child_name}'", exc_info=True)
        return False

    def get_child(self, value: Any, child_name: str) -> Any:
        child_value = None
        try:
            index = int(child_name)
            if value.ndim == 1:
                dimension = value.tolist()
                child_value = dimension[index]
            else:
                child_value = value[:, index].tolist()

            return child_value
        except Exception:
            logger.warning("Unable to get ndarray child: %s", child_name, exc_info=True)
            return []

    def summarize_children(
        self, value: Any, summarizer: Callable[[str, Any], Optional[EnvironmentVariable]]
    ) -> list:
        # Treat collection items as children, with the index as the name
        children = []
        try:
            items = value.tolist()
            for i, item in enumerate(items):
                if len(children) >= MAX_ITEMS:
                    break

                summary = summarizer(str(i), item)
                if summary is not None:
                    children.append(summary)
        except Exception:
            logger.warning("Error summarizing Numpy ndarray children", exc_info=True)

        return children

    def equals(self, value1: Any, value2: Any) -> bool:
        # Try to use numpy's array_equal
        try:
            import numpy as np

            return np.array_equal(value1, value2)
        except Exception as err:
            logger.warning("numpy equals %s", err, exc_info=True)

        # Fallback to comparing the raw bytes
        if value1.shape != value2.shape:
            return False
        return value1.tobytes() == value2.tobytes()

    def copy(self, value: Any) -> Any:
        return value.copy()

    def is_snapshottable(self, value: Any) -> bool:
        return True


class TorchTensorInspector(NumpyNdarrayInspector):
    CLASS_QNAME = "torch.Tensor"

    def get_display_value(
        self, value: torch.Tensor, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        try:
            # NOTE: Once https://github.com/pytorch/pytorch/commit/e03800a93af55ef61f2e610d65ac7194c0614edc
            #       is in a stable version we can use it to temporarily set print options
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
        except Exception:
            logger.warning("Unable to display torch.Tensor", exc_info=True)
            return (self.get_display_type(value), True)

        return display_value, True

    def equals(self, value1: Any, value2: Any) -> bool:
        try:
            import torch

            return torch.equal(value1, value2)
        except Exception as err:
            logger.warning("torch equals %s", err, exc_info=True)

        # Fallback to comparing the raw bytes, using pytorch's custom pickle handler
        if value1.shape != value2.shape:
            return False
        return pickle.dumps(value1) == pickle.dumps(value2)

    def copy(self, value: Any) -> Any:
        # Detach the tensor from any existing computation graphs to avoid gradients propagating
        # through them.
        # TODO: This creates a completely new tensor using new memory. Is there a more
        #       memory-efficient way to do this?
        return value.detach().clone()


INSPECTORS = {
    PandasDataFrameInspector.CLASS_QNAME: PandasDataFrameInspector(),
    PandasSeriesInspector.CLASS_QNAME: PandasSeriesInspector(),
    NumpyNdarrayInspector.CLASS_QNAME: NumpyNdarrayInspector(),
    TorchTensorInspector.CLASS_QNAME: TorchTensorInspector(),
    **dict.fromkeys(PolarsInspector.CLASS_QNAME, PolarsInspector()),
    "boolean": BooleanInspector(),
    "bytes": BytesInspector(),
    "collection": CollectionInspector(),
    "function": FunctionInspector(),
    "map": MapInspector(),
    "number": NumberInspector(),
    "string": StringInspector(),
    "table": TableInspector(),
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
