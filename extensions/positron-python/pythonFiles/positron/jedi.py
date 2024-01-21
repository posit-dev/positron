#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

from typing import Any, Tuple

from ._vendor.jedi import cache, debug
from ._vendor.jedi.api import Interpreter
from ._vendor.jedi.api.classes import Completion
from ._vendor.jedi.api.completion import (
    Completion as CompletionAPI,  # Rename to avoid conflict with classes.Completion
)
from ._vendor.jedi.api.completion import (
    _extract_string_while_in_string,
    _remove_duplicates,
    filter_names,
)
from ._vendor.jedi.api.file_name import complete_file_name
from ._vendor.jedi.api.interpreter import MixedModuleContext
from ._vendor.jedi.api.strings import complete_dict, get_quote_ending
from ._vendor.jedi.cache import memoize_method
from ._vendor.jedi.file_io import KnownContentFileIO
from ._vendor.jedi.inference.base_value import HasNoContext
from ._vendor.jedi.inference.compiled import ExactValue
from ._vendor.jedi.inference.compiled.mixed import MixedName, MixedObject
from ._vendor.jedi.inference.compiled.value import CompiledName, CompiledValue
from ._vendor.jedi.inference.context import ValueContext
from ._vendor.jedi.inference.helpers import infer_call_of_leaf
from ._vendor.jedi.inference.value import ModuleValue
from ._vendor.jedi.parser_utils import cut_value_at_position
from .utils import safe_isinstance

#
# We adapt code from the MIT-licensed jedi static analysis library to provide enhanced completions
# for data science users. Note that we've had to dip into jedi's private API to do that. Jedi is
# available at:
#
# https://github.com/davidhalter/jedi
#

_sentinel = object()


class PositronMixedModuleContext(MixedModuleContext):
    """
    A `jedi.api.interpreter.MixedModuleContext` that prefers values from the user's namespace over
    static analysis.

    For example, given the namespace: `{"x": {"a": 0}}`, and the code:

    ```
    x = {"b": 0}
    x['
    ```

    Completing the line `x['` should return `a` and not `b`.
    """

    def get_filters(self, until_position=None, origin_scope=None):
        filters = super().get_filters(until_position, origin_scope)

        # Store the first filter – which corresponds to static analysis of the source code.
        merged_filter = next(filters)

        # Yield the remaining filters – which correspond to the user's namespaces.
        yield from filters

        # Finally, yield the first filter.
        yield merged_filter


class PositronInterpreter(Interpreter):
    """
    A `jedi.Interpreter` that provides enhanced completions for data science users.
    """

    @cache.memoize_method
    def _get_module_context(self):
        if self.path is None:
            file_io = None
        else:
            file_io = KnownContentFileIO(self.path, self._code)
        tree_module_value = ModuleValue(
            self._inference_state,
            self._module_node,
            file_io=file_io,
            string_names=("__main__",),
            code_lines=self._code_lines,
        )
        # --- Start Positron ---
        # Use our custom module context class.
        return PositronMixedModuleContext(
            tree_module_value,
            self.namespaces,
        )
        # --- End Positron ---

    def complete(self, line=None, column=None, *, fuzzy=False):
        self._inference_state.reset_recursion_limitations()
        with debug.increase_indent_cm("complete"):
            # --- Start Positron ---
            # Use our custom completion class.
            completion = PositronCompletion(
                # --- End Positron ---
                self._inference_state,
                self._get_module_context(),
                self._code_lines,
                (line, column),
                self.get_signatures,
                fuzzy=fuzzy,
            )
            return completion.complete()


class PositronCompletion(CompletionAPI):
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

        completions = list(
            filter_names(
                self._inference_state,
                completion_names,
                self.stack,
                self._like_name,
                self._fuzzy,
                cached_name=cached_name,
            )
        )

        return (
            # Removing duplicates mostly to remove False/True/None duplicates.
            _remove_duplicates(prefixed_completions, completions)
            + sorted(
                completions,
                key=lambda x: (x.name.startswith("__"), x.name.startswith("_"), x.name.lower()),
            )
        )


class DictKeyName(CompiledName):
    """
    A dictionary key with support for inferring its value.
    """

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
            python_object = parent.compiled_value.access_handle.access._obj
            if _is_allowed_getitem_type(python_object):
                values = parent.compiled_value.py__simple_getitem__(self._key)
            else:
                values = parent._wrapped_value.py__simple_getitem__(self._key)
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
            return value._compiled_value

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
def _completions_for_dicts(inference_state, dicts, literal_string, cut_end_quote, fuzzy):
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
            obj = dct.compiled_value.access_handle.access._obj
        except AttributeError:
            pass
        else:
            if _is_allowed_getitem_type(obj):
                if hasattr(obj, "columns"):
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
    """
    Can we safely call `obj.__getitem__`?
    """
    # Only trust builtin types and types from popular data science libraries.
    # We specifically compare type(obj) instead of using isinstance because we don't want to trust
    # subclasses of builtin types.
    return (
        type(obj) in (str, list, tuple, bytes, bytearray, dict)
        or safe_isinstance(obj, "pandas", "DataFrame")
        or safe_isinstance(obj, "polars", "DataFrame")
    )


def get_python_object(completion: Completion) -> Tuple[Any, bool]:
    """
    Get the Python object corresponding to a completion, and a boolean indicating whether an object
    was found.
    """
    name = completion._name
    if isinstance(name, (CompiledName, MixedName)):
        value = name.infer_compiled_value()
        if isinstance(value, CompiledValue):
            obj = value.access_handle.access._obj
            return obj, True
    return None, False
