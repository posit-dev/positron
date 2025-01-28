#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import os
import pathlib
import platform
from functools import cached_property
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable, List, Optional, Union

from IPython.core import oinspect

from ._vendor.jedi import settings
from ._vendor.jedi.api import Interpreter, strings
from ._vendor.jedi.api.classes import BaseName, Completion, Name
from ._vendor.jedi.api.interpreter import (
    MixedTreeName,
)
from ._vendor.jedi.cache import memoize_method
from ._vendor.jedi.inference import InferenceState
from ._vendor.jedi.inference.base_value import HasNoContext, Value, ValueSet, ValueWrapper
from ._vendor.jedi.inference.compiled import ExactValue
from ._vendor.jedi.inference.compiled.mixed import MixedName, MixedObject
from ._vendor.jedi.inference.compiled.value import CompiledName, CompiledValue
from ._vendor.jedi.inference.context import ValueContext
from .inspectors import (
    BaseColumnInspector,
    BaseTableInspector,
    PositronInspector,
    get_inspector,
)
from .utils import get_qualname

if TYPE_CHECKING:
    from ._vendor.jedi.inference.lazy_value import LazyKnownValue

#
# We adapt code from the MIT-licensed jedi static analysis library to provide enhanced completions
# for data science users. Note that we've had to dip into jedi's private API to do that. Jedi is
# available at:
#
# https://github.com/davidhalter/jedi
#

# update Jedi cache to not conflict with other Jedi instances
# adapted from jedi.settings.cache_directory

if platform.system().lower() == "windows":
    _cache_directory = pathlib.Path(os.getenv("LOCALAPPDATA") or "~") / "Jedi" / "Positron-Jedi"
elif platform.system().lower() == "darwin":
    _cache_directory = pathlib.Path("~") / "Library" / "Caches" / "Positron-Jedi"
else:
    _cache_directory = pathlib.Path(os.getenv("XDG_CACHE_HOME") or "~/.cache") / "positron-jedi"
settings.cache_directory = _cache_directory.expanduser()


# Store the original versions of Jedi functions/methods that we patch.
_original_interpreter_complete = Interpreter.complete
_original_interpreter_help = Interpreter.help
_original_interpreter_goto = Interpreter.goto
_original_mixed_name_infer = MixedName.infer
_original_mixed_tree_name_infer = MixedTreeName.infer


def _interpreter_complete(
    self: Interpreter,
    line: Optional[int] = None,
    column: Optional[int] = None,
    *,
    fuzzy: bool = False,
) -> List["PositronCompletion"]:
    # Wrap original completions in `PositronCompletion`.
    return [
        PositronCompletion(name)
        for name in _original_interpreter_complete(self, line, column, fuzzy=fuzzy)
    ]


def _interpreter_help(
    self: Interpreter, line: Optional[int] = None, column: Optional[int] = None
) -> List["PositronName"]:
    # Wrap original help items in `PositronName`.
    return [PositronName(name) for name in _original_interpreter_help(self, line, column)]


def _interpreter_goto(
    self: Interpreter,
    line: Optional[int] = None,
    column: Optional[int] = None,
    *,
    follow_imports: bool = False,
    follow_builtin_imports: bool = False,
    only_stubs: bool = False,
    prefer_stubs: bool = False,
) -> List["PositronName"]:
    # Wrap original goto items in `PositronName`.
    return [
        PositronName(name)
        for name in _original_interpreter_goto(
            self,
            line,
            column,
            follow_imports=follow_imports,
            follow_builtin_imports=follow_builtin_imports,
            only_stubs=only_stubs,
            prefer_stubs=prefer_stubs,
        )
    ]


def _mixed_name_infer(self: MixedName) -> ValueSet:
    # Wrap values of known data science types.
    return ValueSet(_wrap_value(value) for value in _original_mixed_name_infer(self))


def _wrap_value(value: MixedObject):
    if _is_pandas_dataframe(value) or _is_pandas_series(value):
        return SafeDictLikeMixedObjectWrapper(value)
    if _is_polars_dataframe(value):
        return PolarsDataFrameMixedObjectWrapper(value)
    return value


def _is_pandas_dataframe(value: Union[MixedObject, Value]) -> bool:
    return (
        value.get_root_context().py__name__() == "pandas.core.frame"
        and value.py__name__() == "DataFrame"
    )


def _is_pandas_series(value: Union[MixedObject, Value]) -> bool:
    return (
        value.get_root_context().py__name__() == "pandas.core.series"
        and value.py__name__() == "Series"
    )


def _is_polars_dataframe(value: Union[MixedObject, Value]) -> bool:
    return (
        value.get_root_context().py__name__() == "polars.dataframe.frame"
        and value.py__name__() == "DataFrame"
    )


class SafeDictLikeMixedObjectWrapper(ValueWrapper):
    """
    A `ValueWrapper` of a `MixedObject` that always allows getitem access.

    This should only be used for known types with safe getitem implementations.
    """

    _wrapped_value: MixedObject
    compiled_value: CompiledValue

    def __init__(self, wrapped_value: MixedObject) -> None:
        super().__init__(wrapped_value)

        # Enable dict completion for this object.
        self.array_type = "dict"

    def py__simple_getitem__(self, index) -> ValueSet:
        # Get the item without any safety checks.
        return self.compiled_value.py__simple_getitem__(index)


class PolarsDataFrameMixedObjectWrapper(SafeDictLikeMixedObjectWrapper):
    def get_key_values(self):
        # Polars dataframes don't have `.keys()`, instead iterate through `.columns`.
        for columns in self._wrapped_value.py__getattribute__("columns"):
            columns: CompiledValue
            for values in columns.py__iter__():
                values: LazyKnownValue
                yield from values.infer()


def _mixed_tree_name_infer(self: MixedTreeName) -> ValueSet:
    # First search the user's namespace, then fall back to static analysis.
    # This is the reverse of the original implementation.
    # See: https://github.com/posit-dev/positron/issues/601.
    for compiled_value in self.parent_context.mixed_values:
        for f in compiled_value.get_filters():
            values = ValueSet.from_sets(n.infer() for n in f.get(self.string_name))
            if values:
                return values

    return _original_mixed_tree_name_infer(self)


class PositronName(Name):
    """
    Wraps a `jedi.api.classes.BaseName` to customize LSP responses.

    `jedi_language_server` accesses a name's properties to generate `lsprotocol` types which are
    sent to the client. We override these properties to customize LSP responses.
    """

    def __init__(self, name: BaseName) -> None:
        super().__init__(name._inference_state, name._name)  # noqa: SLF001

        # Store the original name.
        self._wrapped_name = name

    @cached_property
    def _inspector(self) -> Optional[PositronInspector]:
        """A `PositronInspector` for the object referenced by this name, if available."""
        name = self._wrapped_name._name  # noqa: SLF001
        # Does the wrapped name reference an actual object?
        if isinstance(name, (CompiledName, MixedName)):
            # Infer the object.
            value = name.infer_compiled_value()
            # Can we access the underlying object itself?
            if isinstance(value, CompiledValue):
                # Get an inspector for the object.
                obj = value.access_handle.access._obj  # noqa: SLF001
                return get_inspector(obj)
        return None

    @property
    def full_name(self):  # type: ignore
        if self._inspector:
            return get_qualname(self._inspector.value)
        return super().full_name

    @property
    def description(self):
        if self._inspector:
            return self._inspector.get_display_type()
        return super().description

    @property
    def module_path(self):
        if self._inspector:
            fname = oinspect.find_file(self._inspector.value)
            if fname is not None:
                return Path(fname)
        return super().module_path

    def docstring(self, raw=False, fast=True):  # noqa: ARG002, FBT002
        if self._inspector:
            if isinstance(self._inspector, (BaseColumnInspector, BaseTableInspector)):
                # Return a preview of the column/table.
                return str(self._inspector.value)

            # Return the value's docstring.
            return self._inspector.value.__doc__ or ""

        return super().docstring(raw=raw)

    def get_signatures(self):
        if isinstance(self._inspector, (BaseColumnInspector, BaseTableInspector)):
            return []
        return super().get_signatures()


class PositronCompletion(PositronName):
    """Wraps a `jedi.api.classes.Completion` to customize LSP responses."""

    def __init__(self, completion: Completion) -> None:
        super().__init__(completion)

        # Store the original completion.
        self._wrapped_completion = completion

    @property
    def complete(self):
        return self._wrapped_completion.complete


class DictKeyName(CompiledName):
    """A dictionary key which can infer its own value."""

    def __init__(
        self,
        inference_state: InferenceState,
        parent_value: CompiledValue,
        name: str,
        is_descriptor: bool,  # noqa: FBT001
        key: Any,
    ):
        self._inference_state = inference_state
        try:
            self.parent_context = parent_value.as_context()
        except HasNoContext:
            # If we're completing a dict literal, e.g. `{'a': 0}['`, then parent_value is a
            # DictLiteralValue which does not override `as_context()`.
            # Manually create the context instead.
            self.parent_context = ValueContext(parent_value)
        self._parent_value = parent_value
        self.string_name = name
        self.is_descriptor = is_descriptor
        self._key = key

    @memoize_method
    def infer_compiled_value(self) -> Optional[CompiledValue]:
        for value in self._parent_value.py__simple_getitem__(self._key):
            # This may return an ExactValue which wraps a CompiledValue e.g. when completing a dict
            # literal like: `{"a": 0}['`.
            # For some reason, ExactValue().get_signatures() returns an empty list, but
            # ExactValue()._compiled_value.get_signatures() returns the correct signatures,
            # so we return the wrapped compiled value instead.
            if isinstance(value, ExactValue):
                return value._compiled_value  # noqa: SLF001
            return value
        return None


# Adapted from `jedi.api.strings._completions_for_dicts` to use a `DictKeyName`,
# which shows a preview of tables/columns in the hover text.
def _completions_for_dicts(
    inference_state: InferenceState,
    dicts: Iterable[CompiledValue],
    literal_string: str,
    cut_end_quote: str,
    fuzzy: bool,  # noqa: FBT001
) -> Iterable[Completion]:
    for dct in dicts:
        if dct.array_type == "dict":
            for key in dct.get_key_values():
                if key:
                    dict_key = key.get_safe_value(default=strings._sentinel)  # noqa: SLF001
                    if dict_key is not strings._sentinel:  # noqa: SLF001
                        dict_key_str = strings._create_repr_string(literal_string, dict_key)  # noqa: SLF001
                        if dict_key_str.startswith(literal_string):
                            string_name = dict_key_str[: -len(cut_end_quote) or None]
                            name = DictKeyName(inference_state, dct, string_name, False, dict_key)  # noqa: FBT003
                            yield Completion(
                                inference_state,
                                name,
                                stack=None,
                                like_name_length=len(literal_string),
                                is_fuzzy=fuzzy,
                            )


def apply_jedi_patches():
    """Apply Positron patches to Jedi."""
    Interpreter.complete = _interpreter_complete
    Interpreter.help = _interpreter_help
    Interpreter.goto = _interpreter_goto
    MixedName.infer = _mixed_name_infer
    MixedTreeName.infer = _mixed_tree_name_infer
    strings._completions_for_dicts = _completions_for_dicts  # noqa: SLF001
