#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import copy
import inspect
import logging
import numbers
import sys
import types
import uuid
from collections.abc import Mapping, Sequence, Set
from typing import Any, Optional, Tuple

from .dataviewer import DataColumn, DataSet
from .utils import get_value_length, get_qualname, pretty_format

TRUNCATE_AT: int = 1024
PRINT_WIDTH: int = 100

# Base inspector for any type


class PositronInspector:
    def get_display_value(
        self,
        value,
        print_width: Optional[int] = PRINT_WIDTH,
        truncate_at: Optional[int] = TRUNCATE_AT,
    ) -> Tuple[str, bool]:
        return pretty_format(value, print_width, truncate_at)

    def get_display_type(self, value) -> str:
        if value is not None:
            type_name = type(value).__name__
            length = self.get_length(value)
            display_type = type_name

            if isinstance(value, str):
                # For strings, which are sequences, we suppress showing
                # the length in the type display
                return type_name

            elif isinstance(value, Set):
                display_type = f"{type_name} {{{length}}}"

            elif isinstance(value, tuple):
                display_type = f"{type_name} ({length})"

            elif isinstance(value, (Sequence, Mapping)):
                display_type = f"{type_name} [{length}]"

            elif length > 0:
                display_type = f"{type_name} [{length}]"

        else:
            display_type = "NoneType"

        return display_type

    def get_kind(self, value) -> str:
        kind = _get_kind(value)
        if kind is None:
            kind = "other"
        return kind

    def get_type_info(self, value) -> str:
        return get_qualname(value)

    def get_length(self, value) -> int:
        return get_value_length(value)

    def get_size(self, value) -> int:
        return sys.getsizeof(value)

    def has_children(self, value) -> bool:
        return self.get_length(value) > 0

    def has_child(self, value, child_name) -> bool:
        return False

    def has_viewer(self, value) -> bool:
        return False

    def get_child_names(self, value) -> list:
        return []

    def get_child_info(self, value, child_name) -> Tuple[str, Any]:
        return ("", [])

    def equals(self, value1, value2) -> bool:
        return value1 == value2

    def copy(self, value) -> Any:
        return copy.copy(value)

    def to_dataset(self, value, title: str) -> Optional[DataSet]:
        return None

    def to_html(self, value) -> str:
        return repr(value)

    def to_tsv(self, value) -> str:
        return repr(value)


# Inspectors by kind


class BooleanInspector(PositronInspector):
    def get_kind(self, value) -> str:
        return "boolean"

    def has_children(self, value) -> bool:
        return False


class BytesInspector(PositronInspector):
    def get_display_value(
        self, value, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        # Ignore print_width for bytes
        return pretty_format(value, None, truncate_at)

    def get_kind(self, value) -> str:
        return "bytes"

    def has_children(self, value) -> bool:
        return False


class CollectionInspector(PositronInspector):
    def get_kind(self, value) -> str:
        return "collection"

    def has_children(self, value) -> bool:
        # For ranges, we don't visualize the children as they're
        # implied as a contiguous set of integers in a range
        # For sets, we don't visualize the children as they're
        # not subscriptable objects
        if isinstance(value, (frozenset, range, set)):
            return False
        else:
            return super().has_children(value)


class FunctionInspector(PositronInspector):
    def get_display_value(
        self, value, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        if callable(value):
            sig = inspect.signature(value)
        else:
            sig = "()"
        return (f"{value.__qualname__}{sig}", False)

    def get_kind(self, value) -> str:
        return "function"

    def has_children(self, value) -> bool:
        return False


class MapInspector(PositronInspector):
    def get_kind(self, value) -> str:
        return "map"


class NumberInspector(PositronInspector):
    def get_kind(self, value) -> str:
        return "number"

    def has_children(self, value) -> bool:
        return False


class StringInspector(PositronInspector):
    def get_display_value(
        self, value, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        # Ignore print_width for strings
        display_value, is_truncated = super().get_display_value(value, None, truncate_at)
        return repr(display_value), is_truncated

    def get_kind(self, value) -> str:
        return "string"

    def has_children(self, value) -> bool:
        return False


class TableInspector(PositronInspector):
    def get_kind(self, value) -> str:
        if value is not None:
            return "table"
        else:
            return "empty"

    def has_viewer(self, value) -> bool:
        return True


# Custom inspectors for specific types


class PandasDataFrameInspector(TableInspector):
    CLASS_QNAME = "pandas.core.frame.DataFrame"

    def get_display_value(
        self, value, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        type_name = type(value).__name__
        shape = value.shape
        return (f"{type_name}: [{shape[0]} rows x {shape[1]} columns]", True)

    def get_display_type(self, value) -> str:
        display_type = type(value).__name__
        shape = value.shape
        display_type = display_type + f" [{shape[0]}x{shape[1]}]"
        return display_type

    def get_child_names(self, value) -> list:
        try:
            return value.columns.values.tolist()
        except Exception:
            return []

    def has_child(self, value, child_name) -> bool:
        return child_name in self.get_child_names(value)

    def get_child_info(self, value, child_name) -> Tuple[str, Any]:
        try:
            column = value[child_name]
            display_type = type(column).__name__
            values = column.values.tolist()

            # Include size information if we have it
            if hasattr(column, "size"):
                size = column.size
            else:
                size = len(values)

            display_type = f"{display_type} [{size}]"
        except Exception:
            display_type = ""
            values = []
            logging.warning("Unable to get Pandas child: %s", child_name, exc_info=True)

        return (display_type, values)

    def equals(self, value1, value2) -> bool:
        return value1.equals(value2)

    def copy(self, value) -> Any:
        return value.copy()

    def to_dataset(self, value, title: str) -> Optional[DataSet]:
        columns = []
        for column_name in self.get_child_names(value):
            column = value[column_name]
            column_type = type(column).__name__
            column_data = column.values.tolist()
            columns.append(DataColumn(column_name, column_type, column_data))

        return DataSet(str(uuid.uuid4()), title, columns)

    def to_html(self, value) -> str:
        return value.to_html()

    def to_tsv(self, value) -> str:
        return value.to_csv(path_or_buf=None, sep="\t")


class PandasSeriesInspector(TableInspector):
    CLASS_QNAME = "pandas.core.series.Series"

    def get_display_value(
        self, value, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        return (str(value), True)

    def get_display_type(self, value) -> str:
        display_type = type(value).__name__
        length = len(value)
        display_type = display_type + f" [{length}]"

        return display_type

    def get_child_names(self, value) -> list:
        try:
            return list(map(str, list(range(value.size))))
        except Exception:
            return []

    def has_child(self, value, child_name) -> bool:
        return child_name in self.get_child_names(value)

    def get_child_info(self, value, child_name) -> Tuple[str, Any]:
        try:
            item = value.iat[int(child_name)]
            display_type = type(item).__name__
            return (display_type, item)
        except Exception:
            logging.warning("Unable to get Series child: %s", child_name, exc_info=True)
        return ("unknown", [])

    def equals(self, value1, value2) -> bool:
        return value1.equals(value2)

    def copy(self, value) -> Any:
        return value.copy()

    def to_html(self, value) -> str:
        # TODO: Support HTML
        return self.to_tsv(value)

    def to_tsv(self, value) -> str:
        return value.to_csv(path_or_buf=None, sep="\t")


class PolarsInspector(TableInspector):
    CLASS_QNAME = "polars.dataframe.frame.DataFrame"

    def get_display_value(
        self, value, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        type_name = type(value).__name__
        shape = value.shape
        return (f"{type_name}: [{shape[0]} rows x {shape[1]} columns]", True)

    def get_display_type(self, value) -> Tuple[int, int]:
        display_type = type(value).__name__
        shape = value.shape
        display_type = display_type + f" [{shape[0]}x{shape[1]}]"

        return display_type

    def get_child_names(self, value) -> list:
        try:
            return value.columns
        except Exception:
            return []

    def has_child(self, value, child_name) -> bool:
        return child_name in self.get_child_names(value)

    def get_child_info(self, value, child_name) -> Tuple[str, Any]:
        try:
            column = value.get_column(child_name)
            display_type = type(column).__name__
            return (display_type, column.to_list())
        except Exception:
            logging.warning("Unable to get Polars child: %s", child_name, exc_info=True)
            return ("unknown", [])

    def equals(self, value1, value2) -> bool:
        return value1.frame_equal(value2)

    def copy(self, value) -> Any:
        return value.clone()

    def to_dataset(self, value, title: str) -> Optional[DataSet]:
        columns = []
        for column_name in self.get_child_names(value):
            column = value.get_column(column_name)
            column_type = type(column).__name__
            column_data = column.to_list()
            columns.append(DataColumn(column_name, column_type, column_data))

        return DataSet(str(uuid.uuid4()), title, columns)

    def to_html(self, value) -> str:
        return value._repr_html_()

    def to_tsv(self, value) -> str:
        return value.write_csv(file=None, separator="\t")


class NumpyNdarrayInspector(TableInspector):
    CLASS_QNAME = "numpy.ndarray"

    def get_display_value(
        self, value, print_width: int = PRINT_WIDTH, truncate_at: int = TRUNCATE_AT
    ) -> Tuple[str, bool]:
        return (str(value), False)

    def get_display_type(self, value) -> str:
        display_type = type(value).__name__
        length = len(value)
        display_type = display_type + f" [{length}]"

        return display_type

    def get_child_names(self, value) -> list:
        try:
            return list(map(str, list(range(len(value)))))
        except Exception:
            return []

    def has_child(self, value, child_name) -> bool:
        return child_name in self.get_child_names(value)

    def get_child_info(self, value, child_name) -> Tuple[str, Any]:
        try:
            child = value[int(child_name)]
            child_display_type = type(child).__name__
            return (child_display_type, child)
        except Exception:
            logging.warning("Unable to get ndarray child: %s", child_name, exc_info=True)
            return ("unknown", [])

    def equals(self, value1, value2) -> bool:
        # Try to use numpy's array_equal
        try:
            import numpy as np

            return np.array_equal(value1, value2)
        except Exception as err:
            logging.warning("numpy equals %s", err, exc_info=True)

        # Fallback to comparing the raw bytes
        if value1.shape != value2.shape:
            return False
        return value1.tobytes() == value2.tobytes()

    def copy(self, value) -> Any:
        return value.copy()


INSPECTORS = {
    PandasDataFrameInspector.CLASS_QNAME: PandasDataFrameInspector(),
    PandasSeriesInspector.CLASS_QNAME: PandasSeriesInspector(),
    PolarsInspector.CLASS_QNAME: PolarsInspector(),
    NumpyNdarrayInspector.CLASS_QNAME: NumpyNdarrayInspector(),
    "boolean": BooleanInspector(),
    "bytes": BytesInspector(),
    "collection": CollectionInspector(),
    "function": FunctionInspector(),
    "map": MapInspector(),
    "number": NumberInspector(),
    "string": StringInspector(),
    "table": TableInspector(),
}


def is_inspectable(value) -> bool:
    qualname = get_qualname(value)
    if qualname in INSPECTORS.keys():
        return True
    return False


def get_inspector(value) -> PositronInspector:
    # Look for a specific inspector by qualified classname
    qualname = get_qualname(value)
    inspector = INSPECTORS.get(qualname, None)

    if inspector is None:
        # Otherwise, look for an inspector by kind
        kind = _get_kind(value)
        if kind is not None:
            inspector = INSPECTORS.get(kind, None)

    # Otherwise, default to generic inspector
    if inspector is None:
        inspector = PositronInspector()

    return inspector


def _get_kind(value) -> Optional[str]:
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
