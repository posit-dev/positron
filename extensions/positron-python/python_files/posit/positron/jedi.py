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


class PositronMixedTreeName(MixedTreeName):
    def infer(self):
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

        return super().infer()


class PositronMixedParserTreeFilter(MixedParserTreeFilter):
    name_class = PositronMixedTreeName


class PositronMixedName(MixedName):
    def infer(self):
        return ValueSet(
            PandasDataFrameMixedObjectWrapper(value)
            if _is_pandas_dataframe(value)
            else SeriesMixedObjectWrapper(value)
            if _is_pandas_series(value)
            else PolarsDataFrameMixedObjectWrapper(value)
            if _is_polars_dataframe(value)
            else value
            for value in super().infer()
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


class PositronMixedObjectFilter(MixedObjectFilter):
    def _create_name(self, *args, **kwargs):
        return PositronMixedName(
            super()._create_name(*args, **kwargs),
            self._tree_value,
        )


class PositronMixedObject(MixedObject):
    def get_filters(self, *args, **kwargs):
        yield PositronMixedObjectFilter(
            self.inference_state, self.compiled_value, self._wrapped_value
        )


class PositronMixedModuleContext(MixedModuleContext):
    """
    Special MixedModuleContext.

    A `jedi.api.interpreter.MixedModuleContext` that prefers values from the user's namespace over
    static analysis.

    For example, given the namespace: `{"x": {"a": 0}}`, and the code:

    ```
    x = {"b": 0}
    x['
    ```

    Completing the line `x['` should return `a` and not `b`.
    """

    def _get_mixed_object(self, compiled_value):
        return PositronMixedObject(compiled_value=compiled_value, tree_value=self._value)

    # TODO: We could patch MixedParserTreeFilter.name_class instead?
    def get_filters(self, until_position=None, origin_scope=None):
        yield MergedFilter(
            PositronMixedParserTreeFilter(
                parent_context=self,
                until_position=until_position,
                origin_scope=origin_scope,
            ),
            self.get_global_filter(),
        )

        for mixed_object in self.mixed_values:
            yield from mixed_object.get_filters(until_position, origin_scope)


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


class PositronInterpreter(Interpreter):
    """A `jedi.Interpreter` that provides enhanced completions for data science users."""

    @cache.memoize_method
    def _get_module_context(self):
        # Use our custom module context class.
        return PositronMixedModuleContext(
            super()._get_module_context()._value,
            self.namespaces,
        )

    @validate_line_column
    def complete(self, line=None, column=None, *, fuzzy=False):
        return [PositronCompletion(name) for name in super().complete(line, column, fuzzy=fuzzy)]

    @validate_line_column
    def help(self, line=None, column=None):
        return [PositronName(name) for name in super().help(line, column)]

    @validate_line_column
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


# TODO: Continue trying to refactor our completion customizations to a plugin.
#       Could even ask Jedi author if we can add a plugin point for this.
class JediPandas:
    def execute(self, callback):
        # TODO: Can this be more specifically TreeValue?
        def wrapper(value: Value, arguments):
            print("execute start")
            result = callback(value, arguments)
            obj_name = value.name.string_name
            print(
                "execute",
                obj_name,
                value.parent_context.py__name__(),
                value.py__name__(),
                value,
                arguments,
                result,
            )
            # if _is_pandas_dataframe(value):
            #     return ValueSet(DataFrameTreeInstanceWrapper(r) for r in result)
            return result

        return wrapper

    # def tree_name_to_values(self, func):
    #     # TODO: Is this always a ModuleContext?
    #     def wrapper(
    #         inference_state: InferenceState, context: ModuleContext, tree_name: TreeName
    #     ) -> ValueSet:
    #         result = func(inference_state, context, tree_name)
    #         # print("tree_name_to_values", tree_name, result, tree_name.value)
    #         # if tree_name.value in ["NDFrame", "PandasObject"]:
    #         return ValueSet(DataFrameWrapper(r) for r in result)
    #         # print("tree_name_to_values", context, tree_name, type(tree_name))
    #         # print("tree_name_to_values", type(inference_state), type(context), type(tree_name))
    #         # if tree_name.value in _FILTER_LIKE_METHODS:
    #         #     # Here we try to overwrite stuff like User.objects.filter. We need
    #         #     # this to make sure that keyword param completion works on these
    #         #     # kind of methods.
    #         #     for v in result:
    #         #         if v.get_qualified_names() == ('_BaseQuerySet', tree_name.value) \
    #         #                 and v.parent_context.is_module() \
    #         #                 and v.parent_context.py__name__() == 'django.db.models.query':
    #         #             qs = context.get_value()
    #         #             generics = qs.get_generics()
    #         #             if len(generics) >= 1:
    #         #                 return ValueSet(QuerySetMethodWrapper(v, model)
    #         #                                 for model in generics[0])

    #         # elif tree_name.value == 'BaseManager' and context.is_module() \
    #         #         and context.py__name__() == 'django.db.models.manager':
    #         #     return ValueSet(ManagerWrapper(r) for r in result)

    #         # elif tree_name.value == 'Field' and context.is_module() \
    #         #         and context.py__name__() == 'django.db.models.fields':
    #         #     return ValueSet(FieldWrapper(r) for r in result)
    #         return result

    #     return wrapper


# class DataFrameWrapper(ValueWrapper):
#     def __getattr__(self, name):
#         print(f"DataFrameWrapper.{name}", self._wrapped_value)
#         return super().__getattr__(name)

#     def get_filters(self, origin_scope=None):
#         result = self._wrapped_value.get_filters(origin_scope=origin_scope)
#         # values = [list(result.values()) for result in iter(result)]
#         # print("get_filters", list(iter(result)), self._wrapped_value)
#         # print("get_filters", origin_scope, values)
#         return result

#     def py__call__(self, arguments):
#         # print("py__call__", arguments)
#         return self._wrapped_value.py__call__(arguments)

#     def py__getitem__(self, index_value_set, contextualized_node):
#         # print("py__getitem__", index_value_set, contextualized_node)
#         return ValueSet(
#             # GenericManagerWrapper(generic)
#             generic
#             for generic in self._wrapped_value.py__getitem__(index_value_set, contextualized_node)
#         )


# class DataFrameTreeInstanceWrapper(ValueWrapper):
#     def __init__(self, *args, **kwargs):
#         print("DataFrameTreeInstanceWrapper.__init__")
#         super().__init__(*args, **kwargs)

#     def __getattr__(self, name):
#         print(f"DataFrameTreeInstanceWrapper.{name}", self._wrapped_value)
#         return super().__getattr__(name)

#     @property
#     def array_type(self):
#         return "dict"


plugin_manager.register(JediPandas())


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
