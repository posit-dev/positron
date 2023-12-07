#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

from jedi import cache
from jedi.api import Interpreter
from jedi.api.interpreter import MixedModuleContext
from jedi.file_io import KnownContentFileIO
from jedi.inference.value import ModuleValue


class PositronMixedModuleContext(MixedModuleContext):
    """
    Like `jedi.api.interpreter.MixedModuleContext` but prefers values from the user's namespace over
    static analysis. See the `PositronInterpreter` docs for more details.
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
    Like `jedi.Interpreter` but prefers values from the user's namespace over static analysis.

    For example, given the namespace: `{"x": {"a": 0}}`, and the code:

    ```
    x = {"b": 0}
    x['
    ```

    Completing the line `x['` should return `a` and not `b`.
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
        return PositronMixedModuleContext(
            tree_module_value,
            self.namespaces,
        )
        # --- End Positron ---
