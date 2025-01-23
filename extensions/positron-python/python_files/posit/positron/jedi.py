#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import os
import pathlib
import platform
from functools import cached_property
from pathlib import Path
from typing import Optional

from IPython.core import oinspect

from ._vendor.jedi import cache, debug, settings
from ._vendor.jedi.api import Interpreter, strings
from ._vendor.jedi.api.classes import BaseName, Completion, Name

# Rename to avoid conflict with classes.Completion
from ._vendor.jedi.api.completion import (
    Completion as CompletionAPI,
)
from ._vendor.jedi.api.completion import (
    _extract_string_while_in_string,
    _remove_duplicates,
    filter_names,
)
from ._vendor.jedi.api.file_name import complete_file_name
from ._vendor.jedi.api.helpers import validate_line_column
from ._vendor.jedi.api.interpreter import (
    MergedFilter,
    MixedModuleContext,
    MixedParserTreeFilter,
    MixedTreeName,
)
from ._vendor.jedi.cache import memoize_method
from ._vendor.jedi.inference.base_value import HasNoContext, Value, ValueSet, ValueWrapper
from ._vendor.jedi.inference.compiled import ExactValue
from ._vendor.jedi.inference.compiled.mixed import MixedName, MixedObject, MixedObjectFilter
from ._vendor.jedi.inference.compiled.value import CompiledName, CompiledValue
from ._vendor.jedi.inference.context import ValueContext
from ._vendor.jedi.inference.filters import MergedFilter
from ._vendor.jedi.plugins import plugin_manager
from .inspectors import (
    BaseColumnInspector,
    BaseTableInspector,
    PositronInspector,
    get_inspector,
)
from .utils import get_qualname

#
# We adapt code from the MIT-licensed jedi static analysis library to provide enhanced completions
# for data science users. Note that we've had to dip into jedi's private API to do that. Jedi is
# available at:
#
# https://github.com/davidhalter/jedi
#


class PositronInterpreter(Interpreter):
    """
    A `jedi.Interpreter` that provides enhanced completions for data science users.
    """

    def complete(self, line=None, column=None, *, fuzzy=False):
        return [PositronCompletion(name) for name in super().complete(line, column, fuzzy=fuzzy)]

    def help(self, line=None, column=None):
        return [PositronName(name) for name in super().help(line, column)]

    def goto(
        self,
        line=None,
        column=None,
        *,
        follow_imports=False,
        follow_builtin_imports=False,
        only_stubs=False,
        prefer_stubs=False,
    ):
        return [
            PositronName(name)
            for name in super().goto(
                line,
                column,
                follow_imports=follow_imports,
                follow_builtin_imports=follow_builtin_imports,
                only_stubs=only_stubs,
                prefer_stubs=prefer_stubs,
            )
        ]


original_mixed_name_infer = MixedName.infer


def _mixed_name_infer(self):
    return ValueSet(_wrap_value(value) for value in original_mixed_name_infer(self))


MixedName.infer = _mixed_name_infer


def _wrap_value(value: Value):
    if _is_pandas_dataframe(value):
        return PandasDataFrameMixedObjectWrapper(value)
    if _is_pandas_series(value):
        return SeriesMixedObjectWrapper(value)
    if _is_polars_dataframe(value):
        return PolarsDataFrameMixedObjectWrapper(value)
    return value


def _is_pandas_dataframe(value: Value) -> bool:
    return (
        value.get_root_context().py__name__() == "pandas.core.frame"
        and value.py__name__() == "DataFrame"
    )


def _is_pandas_series(value: Value) -> bool:
    return (
        value.get_root_context().py__name__() == "pandas.core.series"
        and value.py__name__() == "Series"
    )


def _is_polars_dataframe(value: Value) -> bool:
    return (
        value.get_root_context().py__name__() == "polars.dataframe.frame"
        and value.py__name__() == "DataFrame"
    )


class PandasDataFrameMixedObjectWrapper(ValueWrapper):
    @property
    def array_type(self) -> str:
        return "dict"

    def py__simple_getitem__(self, index):
        # Remove safety checks.
        return self.compiled_value.py__simple_getitem__(index)


class SeriesMixedObjectWrapper(ValueWrapper):
    @property
    def array_type(self) -> str:
        return "dict"

    def py__simple_getitem__(self, index):
        # Remove safety checks.
        return self.compiled_value.py__simple_getitem__(index)


class PolarsDataFrameMixedObjectWrapper(ValueWrapper):
    @property
    def array_type(self) -> str:
        return "dict"

    def get_key_values(self):
        for columns in self._wrapped_value.py__getattribute__("columns"):
            # columns: CompiledValue[List[str]]
            for values in columns.py__iter__():
                # values: LazyKnownValue[CompiledValue[str]]
                for value in values.infer():
                    # value: CompiledValue[str]
                    yield value

    def py__simple_getitem__(self, index):
        # Remove safety checks.
        return self.compiled_value.py__simple_getitem__(index)


original_mixed_tree_name_infer = MixedTreeName.infer


def _mixed_tree_name_infer(self: MixedTreeName):
    # First try to use the namespace, then fall back to static analysis.
    # This is the reverse of MixedTreeName.
    # See: TODO: Link issue here.
    """
    In IPython notebook it is typical that some parts of the code that is
    provided was already executed. In that case if something is not properly
    inferred, it should still infer from the variables it already knows.
    """
    for compiled_value in self.parent_context.mixed_values:
        for f in compiled_value.get_filters():
            values = ValueSet.from_sets(n.infer() for n in f.get(self.string_name))
            if values:
                return values

    return original_mixed_tree_name_infer(self)


MixedTreeName.infer = _mixed_tree_name_infer


class PositronName(Name):
    """
    Wraps a `jedi.api.classes.BaseName` to customize LSP responses.

    `jedi_language_server` acesses name's properties to generate `lsprotocol` types. We override
    these properties to enhance LSP responses. This is usually via a `PositronInspector` on the
    underlying object referenced by the wrapped name.
    """

    def __init__(self, name: BaseName) -> None:
        super().__init__(name._inference_state, name._name)

        self._wrapped_name = name

    @cached_property
    def _inspector(self) -> Optional[PositronInspector]:
        """
        A `PositronInspector` for the object referenced by this name, if available.
        """
        name = self._wrapped_name._name
        if isinstance(name, (CompiledName, MixedName)):
            value = name.infer_compiled_value()
            if isinstance(value, CompiledValue):
                obj = value.access_handle.access._obj
                return get_inspector(obj)
        return None

    @property
    def full_name(self):  # type: ignore
        if self._inspector:
            # TODO: Move to inspector get_full_name method?
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
            # TODO: Move to inspector method?
            fname = oinspect.find_file(self._inspector.value)
            if fname is not None:
                return Path(fname)
        return super().module_path

    def docstring(self, raw=False, fast=True):
        if self._inspector:
            return self._inspector.get_docstring()
        return super().docstring(raw=raw)

    def get_signatures(self):
        # TODO: Move to inspector get_signatures method?
        if isinstance(self._inspector, (BaseColumnInspector, BaseTableInspector)):
            return []
        return super().get_signatures()


class PositronCompletion(PositronName):
    def __init__(self, completion: Completion) -> None:
        super().__init__(completion)

        self._wrapped_completion = completion

    @property
    def complete(self):
        return self._wrapped_completion.complete


_original_completions_for_dicts = strings._completions_for_dicts


class DictKeyName(CompiledName):
    """
    A dictionary key with support for inferring its value.
    """

    def __init__(self, inference_state, parent_value, name, is_descriptor, key):
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
    def infer_compiled_value(self):
        for value in self._parent_value.py__simple_getitem__(self._key):
            # This may return an ExactValue which wraps a CompiledValue e.g. when completing a dict
            # literal like: `{"a": 0}['`.
            # For some reason, ExactValue().get_signatures() returns an empty list, but
            # ExactValue()._compiled_value.get_signatures() returns the correct signatures,
            # so we return the wrapped compiled value instead.
            if isinstance(value, ExactValue):
                return value._compiled_value
            return value


def _completions_for_dicts(inference_state, dicts, literal_string, cut_end_quote, fuzzy):
    for dct in dicts:
        if dct.array_type == "dict":
            for key in dct.get_key_values():
                dict_key = key.get_safe_value(default=strings._sentinel)
                if dict_key is not strings._sentinel:
                    dict_key_str = strings._create_repr_string(literal_string, dict_key)
                    if dict_key_str.startswith(literal_string):
                        string_name = dict_key_str[: -len(cut_end_quote) or None]
                        name = DictKeyName(inference_state, dct, string_name, False, dict_key)
                        yield Completion(
                            inference_state,
                            name,
                            stack=None,
                            like_name_length=len(literal_string),
                            is_fuzzy=fuzzy,
                        )

    return _original_completions_for_dicts(
        inference_state, dicts, literal_string, cut_end_quote, fuzzy
    )


strings._completions_for_dicts = _completions_for_dicts
