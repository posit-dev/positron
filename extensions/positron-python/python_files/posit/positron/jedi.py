#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import os
import pathlib
import platform
from functools import cached_property
from pathlib import Path
from typing import Any, Optional, Tuple

from IPython.core import oinspect

from ._vendor.jedi import cache, debug, settings
from ._vendor.jedi.api import Interpreter
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
from ._vendor.jedi.api.strings import get_quote_ending
from ._vendor.jedi.cache import memoize_method
from ._vendor.jedi.file_io import KnownContentFileIO
from ._vendor.jedi.inference import InferenceState
from ._vendor.jedi.inference.base_value import HasNoContext, Value, ValueSet, ValueWrapper
from ._vendor.jedi.inference.compiled import ExactValue, create_from_access_path
from ._vendor.jedi.inference.compiled.access import create_access_path
from ._vendor.jedi.inference.compiled.mixed import MixedName, MixedObject, MixedObjectFilter
from ._vendor.jedi.inference.compiled.value import CompiledName, CompiledValue
from ._vendor.jedi.inference.context import ModuleContext, ValueContext
from ._vendor.jedi.inference.filters import MergedFilter
from ._vendor.jedi.inference.helpers import infer_call_of_leaf
from ._vendor.jedi.inference.value import ModuleValue
from ._vendor.jedi.parser_utils import cut_value_at_position
from ._vendor.jedi.plugins import plugin_manager
from ._vendor.parso.python.tree import Name as TreeName
from .inspectors import (
    BaseColumnInspector,
    BaseTableInspector,
    PositronInspector,
    get_inspector,
)
from .utils import get_qualname, safe_isinstance

#
# We adapt code from the MIT-licensed jedi static analysis library to provide enhanced completions
# for data science users. Note that we've had to dip into jedi's private API to do that. Jedi is
# available at:
#
# https://github.com/davidhalter/jedi
#

_sentinel = object()


class PositronMixedTreeName(MixedTreeName):
    def __init__(self, *args, **kwargs):
        print("PositronMixedTreeName.__init__")  # , args, kwargs)
        super().__init__(*args, **kwargs)

    def infer(self):
        # First try to use the namespace, then fall back to static analysis.
        # This is the reverse of MixedTreeName.
        # See: TODO: Link issue here.
        """
        In IPython notebook it is typical that some parts of the code that is
        provided was already executed. In that case if something is not properly
        inferred, it should still infer from the variables it already knows.
        """
        print("PositronMixedTreeName.infer", self.string_name)
        for compiled_value in self.parent_context.mixed_values:
            for f in compiled_value.get_filters():
                values = ValueSet.from_sets(n.infer() for n in f.get(self.string_name))
                if values:
                    return values

        return super().infer()


class PositronMixedParserTreeFilter(MixedParserTreeFilter):
    name_class = PositronMixedTreeName

    def __init__(self, *args, **kwargs):
        print("PositronMixedParserTreeFilter.__init__")  # , args, kwargs)
        super().__init__(*args, **kwargs)

    def _filter(self, names):
        result = super()._filter(names)
        print("PositronMixedParserTreeFilter._filter", names, result)
        return result


class PositronMixedName(MixedName):
    # TODO: infer() eventually calls down to execute(). Can we somehow use this for pandas dataframe completions
    #       from a namespace?
    def infer(self):
        result = super().infer()
        print(
            "PositronMixedName.infer",
            self.string_name,
            result,
            [(value.get_root_context().py__name__(), value.py__name__()) for value in iter(result)],
        )
        return ValueSet(
            # TODO: value? tree instance?
            PandasDataFrameMixedObjectWrapper(value)
            if _is_pandas_dataframe(value)
            else SeriesMixedObjectWrapper(value)
            if _is_pandas_series(value)
            else PolarsDataFrameMixedObjectWrapper(value)
            if _is_polars_dataframe(value)
            else value
            for value in result
        )


class PandasDataFrameMixedObjectWrapper(ValueWrapper):
    def __init__(self, wrapped_value):
        print("DataFrameMixedObjectWrapper.__init__", wrapped_value)
        super().__init__(wrapped_value)

    @property
    def array_type(self) -> str:
        return "dict"

    # def get_key_values(self):
    #     result = self._wrapped_value.get_key_values()
    #     breakpoint()
    #     return result


class SeriesMixedObjectWrapper(ValueWrapper):
    def __init__(self, wrapped_value):
        print("SeriesMixedObjectWrapper.__init__", wrapped_value)
        super().__init__(wrapped_value)

    @property
    def array_type(self) -> str:
        return "dict"


class PolarsDataFrameMixedObjectWrapper(ValueWrapper):
    def __init__(self, wrapped_value):
        print("DataFrameMixedObjectWrapper.__init__", wrapped_value)
        super().__init__(wrapped_value)

    @property
    def array_type(self) -> str:
        return "dict"

    def get_key_values(self):
        for columns in self._wrapped_value.py__getattribute__("columns"):
            # columns: CompiledValue[List[str]]
            for seq_value in columns.py__iter__():
                # seq_value: LazyKnownValue[CompiledValue[str]]
                for value in seq_value.infer():
                    # value: CompiledValue[str]
                    yield value


class PositronMixedObjectFilter(MixedObjectFilter):
    def _create_name(self, *args, **kwargs):
        return PositronMixedName(
            super()._create_name(*args, **kwargs),
            self._tree_value,
        )


class PositronMixedObject(MixedObject):
    # def get_filters(self, *args, **kwargs):
    #     result = super().get_filters(*args, **kwargs)
    #     print("PositronMixedObject.get_filters", self, list(iter(result)))
    #     return result

    def get_filters(self, *args, **kwargs):
        yield PositronMixedObjectFilter(
            self.inference_state, self.compiled_value, self._wrapped_value
        )


class NamespaceObject:
    def __init__(self, dct):
        self.__dict__ = dct


class PositronMixedModuleContext(ModuleContext):
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

    # TODO: May not need to override this if we subclass MixedModuleContext and just override _get_mixed_object,
    #       unless we need to override NamespaceObject for some reason.
    def __init__(self, tree_module_value, namespaces):
        super().__init__(tree_module_value)
        self.mixed_values = [
            self._get_mixed_object(
                create_from_access_path(
                    self.inference_state,
                    create_access_path(self.inference_state, NamespaceObject(n)),
                )
            )
            for n in namespaces
        ]

    def _get_mixed_object(self, compiled_value):
        return PositronMixedObject(compiled_value=compiled_value, tree_value=self._value)

    def get_filters(self, until_position=None, origin_scope=None):
        # TODO: Could we yield from super and wrap MixedParserTreeFilter results?
        # filters = super().get_filters(until_position, origin_scope)

        # # Store the first filter – which corresponds to static analysis of the source code.
        # merged_filter = next(filters)

        # # Yield the remaining filters – which correspond to the user's namespaces.
        # yield from filters

        # # Finally, yield the first filter.
        # yield merged_filter
        yield MergedFilter(
            PositronMixedParserTreeFilter(
                parent_context=self, until_position=until_position, origin_scope=origin_scope
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
        self._inference_state.reset_recursion_limitations()
        with debug.increase_indent_cm("complete"):
            # --- Start Positron ---
            # Use our custom completion class.
            completion = PositronCompletionAPI(
                # --- End Positron ---
                self._inference_state,
                self._get_module_context(),
                self._code_lines,
                (line, column),
                self.get_signatures,
                fuzzy=fuzzy,
            )
            # --- Start Positron ---
            return [PositronCompletion(name) for name in completion.complete()]
            # --- End Positron ---

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


class PositronCompletionAPI(CompletionAPI):
    # As is from jedi.api.completion.Completion, copied here to use our `complete_dict`.
    def complete(self):
        leaf = self._module_node.get_leaf_for_position(
            self._original_position, include_prefixes=True
        )
        string, start_leaf, quote = _extract_string_while_in_string(leaf, self._original_position)

        prefixed_completions = complete_dict(
            self._module_context,
            self._code_lines,
            start_leaf or leaf,
            self._original_position,
            None if string is None else quote + string,  # type: ignore
            fuzzy=self._fuzzy,
        )

        if string is not None and not prefixed_completions:
            prefixed_completions = list(
                complete_file_name(
                    self._inference_state,
                    self._module_context,
                    start_leaf,
                    quote,
                    string,
                    self._like_name,
                    self._signatures_callback,
                    self._code_lines,
                    self._original_position,
                    self._fuzzy,
                )
            )
        if string is not None:
            if not prefixed_completions and "\n" in string:
                # Complete only multi line strings
                prefixed_completions = self._complete_in_string(start_leaf, string)
            return prefixed_completions

        cached_name, completion_names = self._complete_python(leaf)

        imported_names = []
        if leaf.parent is not None and leaf.parent.type in ["import_as_names", "dotted_as_names"]:
            imported_names.extend(extract_imported_names(leaf.parent))  # type: ignore  # noqa: F821

        completions = list(
            filter_names(
                self._inference_state,
                completion_names,
                self.stack,
                self._like_name,
                self._fuzzy,
                imported_names,
                cached_name=cached_name,
            )
        )

        return (
            # Removing duplicates mostly to remove False/True/None duplicates.
            _remove_duplicates(prefixed_completions, completions)
            + sorted(
                completions,
                key=lambda x: (
                    not x.name.startswith(self._like_name),
                    x.name.startswith("__"),
                    x.name.startswith("_"),
                    x.name.lower(),
                ),
            )
        )


class DictKeyName(CompiledName):
    """A dictionary key with support for inferring its value."""

    def __init__(self, inference_state, parent_value, key):
        self._inference_state = inference_state

        try:
            self.parent_context = parent_value.as_context()
        except HasNoContext:
            # If we're completing a dict literal, e.g. `{'a': 0}['`, then parent_value is a
            # DictLiteralValue which does not override `as_context()`.
            # Manually create the context instead.
            self.parent_context = ValueContext(parent_value)

        self._parent_value = parent_value
        self._key = key
        self.string_name = str(key)

        # NOTE(seem): IIUC is_descriptor is used to return the api_type() 'instance' without an
        # execution. If so, it should be safe to always set it to false, but I may have misread
        # the jedi code.
        self.is_descriptor = False

    @memoize_method
    def infer_compiled_value(self) -> CompiledValue:
        parent = self._parent_value

        # We actually want to override MixedObject.py__simple_getitem__ to include objects from
        # popular data science libraries as allowed getitem types. However, it's simpler to special
        # case here instead of vendoring all instantiations of MixedObject.
        # START: MixedObject.py__simple_getitem__
        if isinstance(parent, MixedObject):
            python_object = parent.compiled_value.access_handle.access._obj  # noqa: SLF001
            if _is_allowed_getitem_type(python_object):
                values = parent.compiled_value.py__simple_getitem__(self._key)
            else:
                values = parent._wrapped_value.py__simple_getitem__(self._key)  # noqa: SLF001
        # END: MixedObject.py__simple_getitem__
        else:
            values = parent.py__simple_getitem__(self._key)

        values = list(values)

        if len(values) != 1:
            raise ValueError(f"Expected exactly one value, got {len(values)}")
        value = values[0]

        # This may return an ExactValue which wraps a CompiledValue e.g. when completing a dict
        # literal like: `{"a": 0}['`.
        # For some reason, ExactValue().get_signatures() returns an empty list, but
        # ExactValue()._compiled_value.get_signatures() returns the correct signatures,
        # so we return the wrapped compiled value instead.
        if isinstance(value, ExactValue):
            return value._compiled_value  # noqa: SLF001

        return value


# As is from jedi.api.completion.Completion, copied here to use our `_completions_for_dicts`.
def complete_dict(module_context, code_lines, leaf, position, string, fuzzy):
    bracket_leaf = leaf
    if bracket_leaf != "[":
        bracket_leaf = leaf.get_previous_leaf()

    cut_end_quote = ""
    if string:
        cut_end_quote = get_quote_ending(string, code_lines, position, invert_result=True)

    if bracket_leaf == "[":
        if string is None and leaf is not bracket_leaf:
            string = cut_value_at_position(leaf, position)

        context = module_context.create_context(bracket_leaf)

        before_node = before_bracket_leaf = bracket_leaf.get_previous_leaf()  # type: ignore
        if before_node in (")", "]", "}"):
            before_node = before_node.parent
        if before_node.type in ("atom", "trailer", "name"):
            values = infer_call_of_leaf(context, before_bracket_leaf)
            return list(
                _completions_for_dicts(
                    module_context.inference_state,
                    values,
                    "" if string is None else string,
                    cut_end_quote,
                    fuzzy=fuzzy,
                )
            )
    return []


# Adapted from jedi.api.strings._completions_for_dicts.
def _completions_for_dicts(inference_state, dicts, literal_string, _cut_end_quote, fuzzy):
    # --- Start Positron ---
    # Since we've modified _get_python_keys to return Names, sort by yielded value's string_name
    # instead of the yielded value itself.
    for name in sorted(_get_python_keys(inference_state, dicts), key=lambda x: repr(x.string_name)):
        # --- End Positron ---
        yield Completion(
            inference_state,
            name,
            stack=None,
            like_name_length=len(literal_string),
            is_fuzzy=fuzzy,
        )


# Adapted from jedi.api.strings._get_python_keys.
def _get_python_keys(inference_state, dicts):
    for dct in dicts:
        # --- Start Positron ---
        # Handle dict-like objects from popular data science libraries.
        try:
            obj = dct.compiled_value.access_handle.access._obj  # noqa: SLF001
        except AttributeError:
            pass
        else:
            if _is_allowed_getitem_type(obj) and hasattr(obj, "columns"):
                for key in obj.columns:
                    yield DictKeyName(inference_state, dct, key)
                return

        # --- End Positron ---
        if dct.array_type == "dict":
            for key in dct.get_key_values():
                dict_key = key.get_safe_value(default=_sentinel)
                if dict_key is not _sentinel:
                    # --- Start Positron ---
                    # Return a DictKeyName instead of a string.
                    yield DictKeyName(inference_state, dct, dict_key)
                    # --- End Positron ---


def _is_allowed_getitem_type(obj: Any) -> bool:
    """Answer to 'Can we safely call `obj.__getitem__`?'."""
    # Only trust builtin types and types from popular data science libraries.
    # We specifically compare type(obj) instead of using isinstance because we don't want to trust
    # subclasses of builtin types.
    return (
        type(obj) in (str, list, tuple, bytes, bytearray, dict)
        or safe_isinstance(obj, "pandas", "DataFrame")
        or safe_isinstance(obj, "polars", "DataFrame")
    )


def get_python_object(completion: BaseName) -> Tuple[Any, bool]:
    """
    Get the Python object corresponding to a completion.

    And a boolean indicating whether an object was found.
    """
    name = completion._name  # noqa: SLF001
    if isinstance(name, (CompiledName, MixedName)):
        value = name.infer_compiled_value()
        if isinstance(value, CompiledValue):
            obj = value.access_handle.access._obj  # noqa: SLF001
            return obj, True
    return None, False


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


# def _is_polars_series(value: Value) -> bool:
#     return (
#         value.get_root_context().py__name__() == "polars.core.frame"
#         and value.py__name__() == "DataFrame"
#     )


# TODO: Continue trying to refactor our completion customizations to a plugin.
#       Could even ask Jedi author if we can add a plugin point for this.
class JediPandas:
    def execute(self, callback):
        # TODO: Can this be more specifically TreeValue?
        def wrapper(value: Value, arguments):
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
            if _is_pandas_dataframe(value):
                return ValueSet(DataFrameTreeInstanceWrapper(r) for r in result)
            return result

        return wrapper

    def tree_name_to_values(self, func):
        # TODO: Is this always a ModuleContext?
        def wrapper(
            inference_state: InferenceState, context: ModuleContext, tree_name: TreeName
        ) -> ValueSet:
            result = func(inference_state, context, tree_name)
            print("tree_name_to_values", tree_name, result, tree_name.value)
            # if tree_name.value in ["NDFrame", "PandasObject"]:
            return ValueSet(DataFrameWrapper(r) for r in result)
            # print("tree_name_to_values", context, tree_name, type(tree_name))
            # print("tree_name_to_values", type(inference_state), type(context), type(tree_name))
            # if tree_name.value in _FILTER_LIKE_METHODS:
            #     # Here we try to overwrite stuff like User.objects.filter. We need
            #     # this to make sure that keyword param completion works on these
            #     # kind of methods.
            #     for v in result:
            #         if v.get_qualified_names() == ('_BaseQuerySet', tree_name.value) \
            #                 and v.parent_context.is_module() \
            #                 and v.parent_context.py__name__() == 'django.db.models.query':
            #             qs = context.get_value()
            #             generics = qs.get_generics()
            #             if len(generics) >= 1:
            #                 return ValueSet(QuerySetMethodWrapper(v, model)
            #                                 for model in generics[0])

            # elif tree_name.value == 'BaseManager' and context.is_module() \
            #         and context.py__name__() == 'django.db.models.manager':
            #     return ValueSet(ManagerWrapper(r) for r in result)

            # elif tree_name.value == 'Field' and context.is_module() \
            #         and context.py__name__() == 'django.db.models.fields':
            #     return ValueSet(FieldWrapper(r) for r in result)
            return result

        return wrapper


class DataFrameWrapper(ValueWrapper):
    def __getattr__(self, name):
        print(f"DataFrameWrapper.{name}", self._wrapped_value)
        return super().__getattr__(name)

    def get_filters(self, origin_scope=None):
        result = self._wrapped_value.get_filters(origin_scope=origin_scope)
        # values = [list(result.values()) for result in iter(result)]
        # print("get_filters", list(iter(result)), self._wrapped_value)
        # print("get_filters", origin_scope, values)
        return result

    def py__call__(self, arguments):
        # print("py__call__", arguments)
        return self._wrapped_value.py__call__(arguments)

    def py__getitem__(self, index_value_set, contextualized_node):
        # print("py__getitem__", index_value_set, contextualized_node)
        return ValueSet(
            # GenericManagerWrapper(generic)
            generic
            for generic in self._wrapped_value.py__getitem__(index_value_set, contextualized_node)
        )


class DataFrameTreeInstanceWrapper(ValueWrapper):
    def __init__(self, *args, **kwargs):
        print("DataFrameTreeInstanceWrapper.__init__")
        super().__init__(*args, **kwargs)

    def __getattr__(self, name):
        print(f"DataFrameTreeInstanceWrapper.{name}", self._wrapped_value)
        return super().__getattr__(name)

    @property
    def array_type(self):
        return "dict"


plugin_manager.register(JediPandas())
