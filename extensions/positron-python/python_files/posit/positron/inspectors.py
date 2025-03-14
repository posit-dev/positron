#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
from __future__ import annotations

import copy
import datetime
import inspect
import logging
import numbers
import pydoc
import re
import sys
import types
from abc import ABC, abstractmethod
from collections.abc import (
    Mapping,
    MutableMapping,
    MutableSequence,
    MutableSet,
    Sequence,
)
from collections.abc import (
    Set as AbstractSet,
)
from inspect import getattr_static
from typing import (
    TYPE_CHECKING,
    Any,
    Callable,
    Collection,
    FrozenSet,
    Generic,
    Iterable,
    Sized,
    Tuple,
    TypeVar,
    Union,
    cast,
)

from .third_party import _numpy, _pandas, _torch
from .utils import (
    JsonData,
    get_qualname,
    numpy_numeric_scalars,
    pretty_format,
    safe_isinstance,
)

if TYPE_CHECKING:
    import contextlib

    import numpy as np
    import pandas as pd
    import polars as pl

    # temporary suppress for python 3.12
    with contextlib.suppress(ImportError):
        import torch  # type: ignore [reportMissingImports]

    # python >= 3.10
    with contextlib.suppress(ImportError):
        import ibis  # noqa: F401


# General display settings
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


SIMPLER_NAMES = {
    "geopandas.geoseries.GeoSeries": "geopandas.GeoSeries",
    "geopandas.geodataframe.GeoDataFrame": "geopandas.GeoDataFrame",
    "pandas.core.frame.DataFrame": "pandas.DataFrame",
    "pandas.core.series.Series": "pandas.Series",
    "polars.dataframe.frame.DataFrame": "polars.DataFrame",
    "polars.series.series.Series": "polars.Series",
    "polars.internals.series.series.Series": "polars.Series",
    "polars.internals.dataframe.frame.DataFrame": "polars.DataFrame",
}


def _remap_ibis_classnames(value):
    # We will provide more nuanced handling of Ibis expressions in the
    # inspector class for ibis.Expr and its many subclasses

    import ibis

    if isinstance(value, ibis.Expr):
        return "ibis.Expr"

    return get_qualname(value)


PACKAGE_REMAPPERS = {
    "ibis": _remap_ibis_classnames,
}


def _get_simplified_qualname(value):
    display_value = get_qualname(value)

    if display_value in SIMPLER_NAMES:
        return SIMPLER_NAMES[display_value]

    top_path = display_value.split(".")[0]

    if top_path in PACKAGE_REMAPPERS:
        return PACKAGE_REMAPPERS[top_path](value)

    return display_value


class PositronInspector(Generic[T]):
    """Base inspector for any type."""

    def __init__(self, value: T) -> None:
        self.value = value

    def get_display_name(self, key: Any) -> str:
        return str(key)

    def get_display_value(
        self,
        print_width: int | None = PRINT_WIDTH,
        truncate_at: int = TRUNCATE_AT,
    ) -> tuple[str, bool]:
        return pretty_format(self.value, print_width, truncate_at)

    def get_display_type(self) -> str:
        type_name = type(self.value).__name__

        if isinstance(self.value, Sized):
            length = self.get_length()
            return f"{type_name} [{length}]"

        return type_name

    def get_kind(self) -> str:
        return _get_kind(self.value)

    def get_type_info(self) -> str:
        return get_qualname(type(self.value))

    def get_length(self) -> int:
        return len(self.value) if isinstance(self.value, Sized) else 0

    def get_size(self) -> int:
        return sys.getsizeof(self.value)

    def has_children(self) -> bool:
        return self.get_length() > 0

    def has_child(self, _key: Any) -> bool:
        return False

    def get_child(self, _key: Any) -> Any:
        raise TypeError(f"get_child() is not implemented for type: {type(self.value)}")

    def get_children(self) -> Iterable[Any]:
        raise TypeError(f"get_children() is not implemented for type: {type(self.value)}")

    def has_viewer(self) -> bool:
        return False

    def is_mutable(self) -> bool:
        # Without any additional information it's safer to assume that the inspector is mutable,
        # which also disables deepcopying. See the `deepcopy` docstring for more.
        return True

    def get_comparison_cost(self) -> int:
        return self.get_size()

    def equals(self, value: T) -> bool:
        try:
            return self.value == value
        except ValueError:
            # If a collection has a nested value that does not support
            # bool(x == y) (like NumPy arrays or other array-like
            # objects), this will error
            return False

    def deepcopy(self) -> T:
        """
        Special deepcopy.

        Inspectors of mutable types are not deepcopyable by default, since deepcopying may have
        unintended side-effects (see https://github.com/posit-dev/positron/issues/2833). To support
        deepcopying, sub-classes must override `deepcopy`.
        """
        if self.is_mutable():
            raise copy.Error(f"Deepcopying is not supported for type: {type(self.value)}")
        # If the value is immutable, the deepcopy may reference the same value.
        return self.value

    def to_html(self) -> str:
        return repr(self.value)

    def to_plaintext(self) -> str:
        return repr(self.value)

    def to_json(self) -> JsonData:
        return {"type": self.type_to_json(), "data": self.value_to_json()}

    def type_to_json(self) -> str:
        return self.get_type_info()

    def value_to_json(self) -> JsonData:
        raise NotImplementedError(
            f"value_to_json() is not implemented for this type. type: {type(self.value)}"
        )

    @classmethod
    def from_json(cls, json_data: JsonData) -> T:
        if not isinstance(json_data, dict):
            raise ValueError(f"Expected json_data to be dict, got {json_data}")

        if not isinstance(json_data["type"], str):
            raise ValueError(f"Expected json_data['type'] to be str, got {json_data['type']}")

        # TODO(pyright): cast shouldn't be necessary, recheck in a future version of pyright
        return cls.value_from_json(cast("str", json_data["type"]), json_data["data"])

    @classmethod
    def value_from_json(cls, type_name: str, data: JsonData) -> T:
        raise NotImplementedError(
            f"value_from_json() is not implemented for this type. type_name: {type_name}, data: {data}"
        )


#
# Scalars
#


class NoneInspector(PositronInspector[type(None)]):
    def is_mutable(self) -> bool:
        return False


class BooleanInspector(PositronInspector[bool]):
    def is_mutable(self) -> bool:
        return False

    def get_kind(self) -> str:
        return "boolean"

    def value_to_json(self) -> JsonData:
        return self.value

    @classmethod
    def value_from_json(cls, _type_name: str, data: JsonData) -> bool:
        if not isinstance(data, bool):
            raise ValueError(f"Expected data to be bool, got {data}")

        return data


class BytesInspector(PositronInspector[bytes]):
    def is_mutable(self) -> bool:
        return not isinstance(self.value, bytes)

    def deepcopy(self) -> bytes:
        if isinstance(self.value, bytearray):
            # Bytearrays are mutable, but can only hold bytes, so it's safe to use the default
            # deepcopy implementation.
            return copy.deepcopy(self.value)
        return super().deepcopy()

    def get_display_value(
        self,
        _print_width: int | None = PRINT_WIDTH,
        truncate_at: int = TRUNCATE_AT,
    ) -> tuple[str, bool]:
        # Ignore print_width for strings
        return super().get_display_value(None, truncate_at)

    def get_kind(self) -> str:
        return "bytes"

    def has_children(self) -> bool:
        return False

    def value_to_json(self) -> str:
        return self.value.decode()

    @classmethod
    def value_from_json(cls, _type_name: str, data: JsonData) -> bytes:
        if not isinstance(data, str):
            raise ValueError(f"Expected data to be str, got {data}")

        return data.encode()


#
# Objects
#


class ObjectInspector(PositronInspector[T], ABC):
    def has_child(self, key: str) -> bool:
        return hasattr(self.value, key)

    def get_length(self) -> int:
        if isinstance(self.value, property):
            return 0
        return len([p for p in dir(self.value) if not (p.startswith("_"))])

    def get_children(self):
        return (p for p in dir(self.value) if not (p.startswith("_")))

    def get_child(self, key: str) -> Any:
        # If the attr is a method, getattr_static will return the wrapped function, but we want the method
        attr = getattr_static(self.value, key)
        if callable(attr):
            return getattr(self.value, key)
        else:
            return attr


class ClassInspector(ObjectInspector[type]):
    def get_kind(self) -> str:
        return "class"

    def value_to_json(self) -> JsonData:
        return str(self.value)

    @classmethod
    def value_from_json(cls, _type_name: str, data: JsonData) -> type:
        if not isinstance(data, str):
            raise ValueError(f"Expected data to be str, got {data}")

        pattern = "(?<=<class ').*(?='>)"
        match = re.search(pattern, data)
        if match is None:
            raise ValueError(f"Could not find class name in {data}")
        # pydoc.locate will work for both built-in classes as well as any classes on the path
        class_name = pydoc.locate(match.group(0))
        if not isinstance(class_name, type):
            raise ValueError(f"Could not locate a type named {data}")
        return class_name


class PropertyInspector(PositronInspector[property]):
    def is_mutable(self) -> bool:
        return False


class FunctionInspector(PositronInspector[Callable]):
    def is_mutable(self) -> bool:
        return False

    def get_display_value(
        self,
        _print_width: int | None = PRINT_WIDTH,
        _truncate_at: int = TRUNCATE_AT,
    ) -> tuple[str, bool]:
        sig = inspect.signature(self.value) if callable(self.value) else "()"
        return (f"{self.value.__qualname__}{sig}", False)

    def get_kind(self) -> str:
        return "function"


NT = TypeVar("NT", numbers.Number, "np.number")


class NumberInspector(PositronInspector[NT], ABC):
    def get_display_type(self) -> str:
        ty = type(self.value)
        mod = ty.__module__
        name = ty.__name__
        if mod == "builtins":
            return name
        else:
            return f"{mod}.{name}"

    def is_mutable(self) -> bool:
        return False

    def get_kind(self) -> str:
        return "number"

    def type_to_json(self) -> str:
        # Note that our serialization of numbers is lossy, since for example `numpy.int8(0)` would
        # be serialized as `int`. This is fine for our purposes, since `numpy.int8(0)` and `int(0)`
        # can be used interchangeably as keys in a dictionary.
        if isinstance(self.value, numbers.Integral):
            return "int"
        if isinstance(self.value, numbers.Real):
            return "float"
        if isinstance(self.value, numbers.Complex):
            return "complex"
        raise NotImplementedError(
            f"type_to_json() is not implemented for this type. type: {type(self.value)}"
        )

    def value_to_json(self) -> JsonData:
        if isinstance(self.value, numbers.Integral):
            return int(self.value)
        if isinstance(self.value, numbers.Real):
            return float(self.value)
        if isinstance(self.value, numbers.Complex):
            return str(self.value)
        return super().value_to_json()

    @classmethod
    def value_from_json(cls, type_name: str, data: JsonData) -> NT | numbers.Number:
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
            return cast("numbers.Number", complex(data))

        return super().value_from_json(type_name, data)


class NumpyNumberInspector(NumberInspector["np.number"]):
    CLASS_QNAME = numpy_numeric_scalars

    def get_display_value(
        self,
        print_width: int | None = PRINT_WIDTH,
        truncate_at: int = TRUNCATE_AT,
    ) -> tuple[str, bool]:
        # numpy numbers do not print cleanly as of numpy 2.0
        # use the self.value.item() to retrieve the actual number
        return pretty_format(self.value.item(), print_width, truncate_at)


class StringInspector(PositronInspector[str]):
    def is_mutable(self) -> bool:
        return False

    def get_display_value(
        self,
        _print_width: int | None = PRINT_WIDTH,
        truncate_at: int = TRUNCATE_AT,
    ) -> tuple[str, bool]:
        # Ignore print_width for strings
        display_value, is_truncated = super().get_display_value(None, truncate_at)

        # Use repr() to show quotes around strings
        return repr(display_value), is_truncated

    def get_display_type(self) -> str:
        # Don't include the length for strings
        return type(self.value).__name__

    def get_kind(self) -> str:
        return "string"

    def has_children(self) -> bool:
        return False

    def value_to_json(self) -> JsonData:
        return self.value

    @classmethod
    def value_from_json(cls, _type_name: str, data: JsonData) -> str:
        if not isinstance(data, str):
            raise ValueError(f"Expected data to be str, got {data}")

        return data


Timestamp = TypeVar("Timestamp", datetime.datetime, "pd.Timestamp")


class _BaseTimestampInspector(PositronInspector[Timestamp], ABC):
    def is_mutable(self) -> bool:
        return False

    @classmethod
    @abstractmethod
    def value_from_isoformat(cls, string: str) -> Timestamp:
        pass

    def value_to_json(self) -> JsonData:
        return self.value.isoformat()

    @classmethod
    def value_from_json(cls, _type_name: str, data: JsonData) -> Timestamp:
        if not isinstance(data, str):
            raise ValueError(f"Expected data to be str, got {data}")

        return cls.value_from_isoformat(data)


class DatetimeInspector(_BaseTimestampInspector[datetime.datetime]):
    CLASS_QNAME = "datetime.datetime"

    @classmethod
    def value_from_isoformat(cls, string: str) -> datetime.datetime:
        return datetime.datetime.fromisoformat(string)


class PandasTimestampInspector(_BaseTimestampInspector["pd.Timestamp"]):
    CLASS_QNAME = "pandas._libs.tslibs.timestamps.Timestamp"

    @classmethod
    def value_from_isoformat(cls, string: str) -> pd.Timestamp:
        return _pandas().Timestamp.fromisoformat(string)


#
# Collections
#

CollectionT = Union[range, FrozenSet, Sequence, AbstractSet, Tuple]
CT = TypeVar("CT", CollectionT, "np.ndarray", "torch.Tensor")


class _BaseCollectionInspector(PositronInspector[CT], ABC):
    def get_kind(self) -> str:
        return "collection"

    def has_children(self) -> bool:
        # For ranges, we don't visualize the children as they're
        # implied as a contiguous set of integers in a range.
        # For sets, we don't visualize the children as they're
        # not subscriptable objects.
        if isinstance(self.value, (range, AbstractSet, FrozenSet)):
            return False

        return super().has_children()

    def has_child(self, key: int) -> bool:
        return key < self.get_length()

    def get_child(self, key: int) -> Any:
        # Don't allow indexing into ranges or sets.
        if isinstance(self.value, (range, AbstractSet, FrozenSet)):
            raise TypeError(f"get_child() is not implemented for type: {type(self.value)}")

        # TODO(pyright): type should be narrowed to exclude frozen set, retry in a future version of pyright
        return self.value[key]  # type: ignore

    def get_children(self) -> Iterable[int]:
        # Treat collection items as children, with the index as the name
        return range(self.get_length())


# We don't use typing.Sequence here since it includes mappings,
# for which we have a separate inspector.


class CollectionInspector(_BaseCollectionInspector[CollectionT]):
    def get_display_type(self) -> str:
        # Display length for various collections and maps
        # using the Python notation for the type
        type_name = type(self.value).__name__
        length = self.get_length()

        if isinstance(self.value, AbstractSet):
            return f"{type_name} {{{length}}}"
        elif isinstance(self.value, tuple):
            return f"{type_name} ({length})"
        else:
            return f"{type_name} [{length}]"

    def get_comparison_cost(self) -> int:
        # Placeholder estimate
        return self.get_length()

    def is_mutable(self) -> bool:
        return (
            isinstance(self.value, (MutableSequence, MutableSet))
            # fastcore's L is a mutable list but doesn't pass the isinstance check.
            or safe_isinstance(self.value, "fastcore.foundation", "L")
        )

    def value_to_json(self) -> JsonData:
        if isinstance(self.value, range):
            return {
                "start": self.value.start,
                "stop": self.value.stop,
                "step": self.value.step,
            }

        return super().value_to_json()

    @classmethod
    def value_from_json(cls, type_name: str, data: JsonData) -> CollectionT:
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
            return range(
                cast("int", data["start"]),
                cast("int", data["stop"]),
                cast("int", data["step"]),
            )

        return super().value_from_json(type_name, data)


Array = TypeVar("Array", "np.ndarray", "torch.Tensor")


class _BaseArrayInspector(_BaseCollectionInspector[Array], ABC):
    def get_kind(self) -> str:
        return "collection" if self.value.ndim > 0 else "number"

    def get_display_type(self) -> str:
        display_type = str(self.value.dtype)

        # Include shape information, only if it's not a scalar
        shape = self.value.shape
        if self.value.ndim == 1:
            # Remove the trailing comma for 1D arrays
            display_type = f"{display_type} ({shape[0]})"
        elif self.value.ndim != 0:
            display_type = f"{display_type} {tuple(shape)}"

        # Prepend the module name if it's not already there, to distinguish different types of
        # arrays e.g. numpy versus pytorch
        module = type(self.value).__module__
        if not display_type.startswith(module):
            display_type = f"{module}.{display_type}"

        return display_type

    def get_comparison_cost(self) -> int:
        # Placeholder estimate
        return self.get_num_cells()

    def get_num_cells(self) -> int:
        """Return the number of value cells in the array."""
        if self.value.ndim == 0:
            return 0

        num_elements = 1
        for dim in self.value.shape:
            num_elements *= dim

        return num_elements

    def get_size(self) -> int:
        dtype = self.value.dtype

        # If it's a non-NumPy dtype, use 8 as a conservative
        # placeholder
        itemsize = getattr(dtype, "itemsize", 8)
        return self.get_num_cells() * itemsize

    def get_length(self) -> int:
        return self.value.shape[0] if self.value.ndim > 0 else 0

    def is_mutable(self) -> bool:
        return True


class NumpyNdarrayInspector(_BaseArrayInspector["np.ndarray"]):
    CLASS_QNAME = "numpy.ndarray"

    def get_display_value(
        self,
        print_width: int | None = PRINT_WIDTH,
        _truncate_at: int = TRUNCATE_AT,
    ) -> tuple[str, bool]:
        return (
            _numpy().array2string(
                self.value,
                max_line_width=print_width,
                threshold=ARRAY_THRESHOLD,
                edgeitems=ARRAY_EDGEITEMS,
                separator=",",
            ),
            True,
        )

    def equals(self, value: np.ndarray) -> bool:
        return _numpy().array_equal(self.value, value)

    def deepcopy(self) -> np.ndarray:
        # TODO: ndarray.copy() is actually a shallow copy which could cause unexpected behavior for
        #       arrays of Python objects. We should raise a copy.Error in that case.
        return self.value.copy()


class TorchTensorInspector(_BaseArrayInspector["torch.Tensor"]):
    CLASS_QNAME = "torch.Tensor"

    def get_display_value(
        self,
        print_width: int | None = PRINT_WIDTH,
        _truncate_at: int = TRUNCATE_AT,
    ) -> tuple[str, bool]:
        # NOTE:
        # Once https://github.com/pytorch/pytorch/commit/e03800a93af55ef61f2e610d65ac7194c0614edc
        # is in a stable version we can use it to temporarily set print options
        torch = _torch()

        new_options = {
            "threshold": ARRAY_THRESHOLD,
            "edgeitems": ARRAY_EDGEITEMS,
            "linewidth": print_width,
        }
        options_obj = torch._tensor_str.PRINT_OPTS  # type: ignore[reportGeneralTypeIssues]  # noqa: SLF001
        original_options = {k: getattr(options_obj, k) for k in new_options}

        torch.set_printoptions(**new_options)

        display_value = str(self.value)
        # Strip the surrounding `tensor(...)`
        display_value = display_value[len("tensor(") : -len(")")]

        torch.set_printoptions(**original_options)

        return display_value, True

    def equals(self, value: torch.Tensor) -> bool:
        return _torch().equal(self.value, value)

    def deepcopy(self) -> torch.Tensor:
        # Detach the tensor from any existing computation graphs to
        # avoid gradients propagating through them.

        # TODO: This creates a completely new tensor using new
        #       memory. Is there a more memory-efficient way to do
        #       this?
        return self.value.detach().clone()

    def get_size(self) -> int:
        if self.value.ndim == 0:
            return self.value.element_size()

        num_elements = 1
        for dim in self.value.shape:
            num_elements *= dim

        return num_elements * self.value.element_size()


#
# Maps
#


MT = TypeVar(
    "MT",
    Mapping,
    "pd.DataFrame",
    "pl.DataFrame",
    "pd.Series",
    "pl.Series",
    "pd.Index",
)


class _BaseMapInspector(PositronInspector[MT], ABC):
    def get_kind(self) -> str:
        return "map"

    def get_num_cells(self) -> int:
        result = 1
        for dim in getattr(self.value, "shape", [len(self.value)]):
            result *= dim

        return result

    def get_size(self) -> int:
        return self.get_num_cells()

    def has_child(self, key: Any) -> bool:
        return key in self.get_children()

    def get_child(self, key: Any) -> Any:
        return self.value[key]


class MapInspector(_BaseMapInspector[Mapping]):
    def get_children(self) -> Collection[Any]:
        return self.value.keys()

    def is_mutable(self) -> bool:
        return isinstance(self.value, MutableMapping)


Column = TypeVar("Column", "pd.Series", "pl.Series", "pd.Index")


class BaseColumnInspector(_BaseMapInspector[Column], ABC):
    def is_mutable(self) -> bool:
        return True

    def get_child(self, key: Any) -> Any:
        return self.value[key]

    def get_children(self) -> Collection[Any]:
        return range(len(self.value))

    def get_display_type(self) -> str:
        return f"{self.value.dtype} [{self.get_length()}]"

    def get_display_value(
        self,
        _print_width: int | None = PRINT_WIDTH,
        _truncate_at: int = TRUNCATE_AT,
    ) -> tuple[str, bool]:
        display_value = _get_simplified_qualname(self.value)
        column_values = str(cast("Column", self.value[:100]).to_list())
        display_value = f"{display_value} {column_values}"

        return (display_value, True)

    def get_size(self) -> int:
        dtype = self.value.dtype

        # If it's a non-NumPy dtype, use 8 as a conservative
        # placeholder
        itemsize = getattr(dtype, "itemsize", 8)
        return self.get_num_cells() * itemsize


class PandasSeriesInspector(BaseColumnInspector["pd.Series"]):
    # Simplified names
    CLASS_QNAME = (
        "pandas.Series",
        "geopandas.GeoSeries",
    )

    def get_display_name(self, key: int) -> str:
        return str(self.value.index[key])

    def get_child(self, key: int) -> Any:
        return self.value.iloc[key]

    def get_kind(self) -> str:
        # #2215 -- we are temporarily reclassifying Series as a table
        # #so that it shows up in the "data" section
        return "table"

    def equals(self, value: pd.Series) -> bool:
        return self.value.equals(value)

    def deepcopy(self) -> pd.Series:
        # Copies memory because pandas < 3.0 does not have
        # copy-on-write.
        return self.value.copy(deep=True)

    def to_html(self) -> str:
        # TODO: Support HTML
        return self.to_plaintext()

    def to_plaintext(self) -> str:
        return self.value.to_csv(path_or_buf=None, sep="\t")

    def has_viewer(self) -> bool:
        return True


class PandasIndexInspector(BaseColumnInspector["pd.Index"]):
    CLASS_QNAME = (
        "pandas.core.indexes.base.Index",
        "pandas.core.indexes.datetimes.DatetimeIndex",
        "pandas.core.indexes.range.RangeIndex",
        "pandas.core.indexes.multi.MultiIndex",
        "pandas.core.indexes.numeric.Int64Index",
    )

    def is_mutable(self) -> bool:
        return False

    def get_display_value(
        self,
        _print_width: int | None = PRINT_WIDTH,
        _truncate_at: int = TRUNCATE_AT,
    ) -> tuple[str, bool]:
        # RangeIndexes don't need to be truncated.
        if isinstance(self.value, _pandas().RangeIndex):
            return str(self.value), False

        display_value = str(self.value[:100].to_list())
        return display_value, True

    def has_children(self) -> bool:
        # For ranges, we don't visualize the children as they're
        # implied as a contiguous set of integers in a range.
        if isinstance(self.value, _pandas().RangeIndex):
            return False

        return super().has_children()

    def equals(self, value: pd.Index) -> bool:
        return self.value.equals(value)

    def to_html(self) -> str:
        # TODO: Support HTML
        return self.to_plaintext()

    def to_plaintext(self) -> str:
        return self.value.to_series().to_csv(path_or_buf=None, sep="\t")


class PolarsSeriesInspector(BaseColumnInspector["pl.Series"]):
    # Simplified class names
    CLASS_QNAME = ("polars.Series",)

    def equals(self, value: pl.Series) -> bool:
        try:
            return self.value.equals(value)
        except AttributeError:  # polars.Series.equals was introduced in v0.19.16
            return self.value.series_equal(value)  # type: ignore

    def deepcopy(self) -> pl.Series:
        # Polars produces a shallow clone and does not copy any memory
        # in this operation.
        return self.value.clone()

    def to_html(self) -> str:
        # TODO: Support HTML
        return self.to_plaintext()

    def to_plaintext(self) -> str:
        return self.value.to_frame().write_csv(file=None, separator="\t")


Table = TypeVar("Table", "pd.DataFrame", "pl.DataFrame")


class BaseTableInspector(_BaseMapInspector[Table], Generic[Table, Column], ABC):
    """Base inspector for tabular data."""

    def get_display_type(self) -> str:
        type_name = type(self.value).__name__
        shape = self.value.shape
        return f"{type_name} [{shape[0]}x{shape[1]}]"

    def get_kind(self) -> str:
        return "table"

    def get_length(self) -> int:
        # send number of columns.
        # number of rows per column is handled by ColumnInspector
        return self.value.shape[1]

    def has_viewer(self) -> bool:
        return True

    def is_mutable(self) -> bool:
        return True

    def get_display_value(
        self,
        _print_width: int | None = PRINT_WIDTH,
        _truncate_at: int = TRUNCATE_AT,
    ) -> tuple[str, bool]:
        display_value = _get_simplified_qualname(self.value)
        if hasattr(self.value, "shape"):
            shape = self.value.shape
            display_value = f"[{shape[0]} rows x {shape[1]} columns] {display_value}"

        return (display_value, True)


#
# Custom inspectors for specific types
#


class PandasDataFrameInspector(BaseTableInspector["pd.DataFrame", "pd.Series"]):
    # Simplified names
    CLASS_QNAME = (
        "pandas.DataFrame",
        "geopandas.GeoDataFrame",
    )

    def get_display_name(self, key: int) -> str:
        return str(self.value.columns[key])

    def get_children(self):
        return range(self.value.shape[1])

    def get_child(self, key: int) -> Any:
        return self.value.iloc[:, key]

    def equals(self, value: pd.DataFrame) -> bool:
        return self.value.equals(value)

    def deepcopy(self) -> pd.DataFrame:
        # Copies memory because pandas < 3.0 does not have
        # copy-on-write.
        return self.value.copy(deep=True)

    def to_html(self) -> str:
        return self.value.to_html()

    def to_plaintext(self) -> str:
        return self.value.to_csv(path_or_buf=None, sep="\t")


class PolarsDataFrameInspector(BaseTableInspector["pl.DataFrame", "pl.Series"]):
    # Simplified class name
    CLASS_QNAME = ("polars.DataFrame",)

    def get_children(self):
        return self.value.columns

    def get_display_value(
        self,
        _print_width: int | None = PRINT_WIDTH,
        _truncate_at: int = TRUNCATE_AT,
    ) -> tuple[str, bool]:
        qualname = _get_simplified_qualname(self.value)
        shape = self.value.shape
        display_value = f"[{shape[0]} rows x {shape[1]} columns] {qualname}"
        return (display_value, True)

    def equals(self, value: pl.DataFrame) -> bool:
        try:
            return self.value.equals(value)
        except AttributeError:  # polars.DataFrame.equals was introduced in v0.19.16
            return self.value.frame_equal(value)  # type: ignore

    def deepcopy(self) -> pl.DataFrame:
        # Polars produces a shallow clone and does not copy any memory
        # in this operation.
        return self.value.clone()

    def to_html(self) -> str:
        return self.value._repr_html_()

    def to_plaintext(self) -> str:
        return self.value.write_csv(file=None, separator="\t")


class BaseConnectionInspector(ObjectInspector):
    def has_viewer(self) -> bool:
        return self._is_active(self.value)

    def get_kind(self) -> str:
        return "connection"

    def is_mutable(self) -> bool:
        return True

    def deepcopy(self):
        # Connections are mutable but not deepcopiable.
        raise copy.Error("Connections are not copiable")

    def _is_active(self, value) -> bool:
        raise NotImplementedError


class SQLiteConnectionInspector(BaseConnectionInspector):
    # in older Python versions (eg 3.9) the qualname for sqlite3.Connection is just "Connection"
    CLASS_QNAME = ("Connection", "sqlite3.Connection")

    def _is_active(self, value) -> bool:
        try:
            # a connection is active if you can acquire a cursor from it
            value.cursor()
        except Exception:
            return False
        return True


class SQLAlchemyEngineInspector(BaseConnectionInspector):
    CLASS_QNAME = ("sqlalchemy.engine.base.Engine",)

    def _is_active(self, value) -> bool:
        try:
            # a connection is active if you can acquire a connection from it
            value.connect()
        except Exception:
            return False
        return True


class IbisExprInspector(PositronInspector["ibis.Expr"]):
    def has_children(self) -> bool:
        return False

    def get_length(self) -> int:
        return 0

    def is_mutable(self):
        return False

    def get_display_value(
        self,
        _print_width: int | None = PRINT_WIDTH,
        _truncate_at: int = TRUNCATE_AT,
    ) -> tuple[str, bool]:
        # Just use the default object.__repr__ for now
        simplified_name = get_qualname(self.value)
        return (f"{simplified_name}", True)

    def get_display_type(self) -> str:
        return "ibis.Expr"

    def to_html(self) -> str:
        return self.get_display_value()[0]

    def to_plaintext(self) -> str:
        return self.get_display_value()[0]


INSPECTOR_CLASSES: dict[str, type[PositronInspector]] = {
    **dict.fromkeys(PandasDataFrameInspector.CLASS_QNAME, PandasDataFrameInspector),
    **dict.fromkeys(PandasSeriesInspector.CLASS_QNAME, PandasSeriesInspector),
    **dict.fromkeys(PandasIndexInspector.CLASS_QNAME, PandasIndexInspector),
    PandasTimestampInspector.CLASS_QNAME: PandasTimestampInspector,
    **dict.fromkeys(NumpyNumberInspector.CLASS_QNAME, NumpyNumberInspector),
    NumpyNdarrayInspector.CLASS_QNAME: NumpyNdarrayInspector,
    TorchTensorInspector.CLASS_QNAME: TorchTensorInspector,
    **dict.fromkeys(PolarsDataFrameInspector.CLASS_QNAME, PolarsDataFrameInspector),
    **dict.fromkeys(PolarsSeriesInspector.CLASS_QNAME, PolarsSeriesInspector),
    DatetimeInspector.CLASS_QNAME: DatetimeInspector,
    **dict.fromkeys(SQLiteConnectionInspector.CLASS_QNAME, SQLiteConnectionInspector),
    **dict.fromkeys(SQLAlchemyEngineInspector.CLASS_QNAME, SQLAlchemyEngineInspector),
    "ibis.Expr": IbisExprInspector,
    "boolean": BooleanInspector,
    "bytes": BytesInspector,
    "class": ClassInspector,
    "collection": CollectionInspector,
    "empty": NoneInspector,
    "function": FunctionInspector,
    "map": MapInspector,
    "number": NumberInspector,
    "other": ObjectInspector,
    "property": PropertyInspector,
    "string": StringInspector,
}

#
# Helper functions
#


def get_inspector(value: T) -> PositronInspector[T]:
    # Look for a specific inspector by qualified classname
    if isinstance(value, type):
        qualname = "type"
    elif isinstance(value, property):
        qualname = "property"
    else:
        qualname = _get_simplified_qualname(value)
    inspector_cls = INSPECTOR_CLASSES.get(qualname)

    if inspector_cls is None:
        # Otherwise, look for an inspector by kind
        kind = _get_kind(value)
        inspector_cls = INSPECTOR_CLASSES.get(kind)

    # Otherwise, default to generic inspector
    if inspector_cls is None:
        inspector_cls = PositronInspector

    return inspector_cls(value)


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
    elif isinstance(value, (Sequence, AbstractSet)):
        return "collection"
    elif isinstance(value, (types.FunctionType, types.MethodType)):
        return "function"
    elif isinstance(value, type):
        return "class"
    elif value is not None:
        return "other"
    else:
        return "empty"
