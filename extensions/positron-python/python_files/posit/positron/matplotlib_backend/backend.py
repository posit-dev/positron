#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
The names of Positron's matplotlib backends, and the interface their modules implement.

Keep this module free of matplotlib imports; see the package docstring.
"""

from __future__ import annotations

import importlib
from enum import Enum
from typing import TYPE_CHECKING, Protocol, cast

from ..session_mode import SessionMode
from .compat import get_backend_registry

if TYPE_CHECKING:
    from IPython.core.interactiveshell import InteractiveShell

_MODULE_PREFIX = "module://"


class Backend(Enum):
    """
    One of Positron's matplotlib backends.

    Both names select the same backend: matplotlib resolves the short name through its
    backend registry (matplotlib >= 3.9), while the `module://` spelling works on any
    version.

    Attributes:
        module_name: The importable path of the backend's module.
        short_name: The name the backend is registered under via the `matplotlib.backend`
            entry point.
    """

    CONSOLE = ("positron.matplotlib_backend.console", "positron-console")
    NOTEBOOK = ("positron.matplotlib_backend.notebook", "positron-notebook")

    def __init__(self, module_name: str, short_name: str) -> None:
        self.module_name = module_name
        self.short_name = short_name

    @classmethod
    def for_session_mode(cls, session_mode: SessionMode) -> Backend:
        """The backend for a session started in `session_mode`."""
        # BACKGROUND sessions get the console backend: they have no notebook to render
        # figures into, and the console backend routes them to the plots pane.
        return cls.NOTEBOOK if session_mode == SessionMode.NOTEBOOK else cls.CONSOLE

    @classmethod
    def from_name(cls, backend: str) -> Backend | None:
        """
        The Positron backend that `backend` selects, or None if `backend` isn't ours.

        Matches either spelling (short name or `module://` name). That matters at a
        backend module's self-activation time (see the trailer at the bottom of
        `console.py`/`notebook.py`): when matplotlib switches to a short name,
        `matplotlib.get_backend()` at module-import time can still report the short
        name rather than the `module://` spelling it eventually settles into.
        """
        # Short names are case-insensitive in matplotlib's registry; `module://` names
        # aren't, since everything after the prefix is an importable module path.
        normalized = backend if backend.startswith(_MODULE_PREFIX) else backend.lower()
        for candidate in cls:
            if normalized in (candidate.full_name, candidate.short_name):
                return candidate
        return None

    @property
    def full_name(self) -> str:
        """Matplotlib's `module://` spelling of `module_name`; works on any matplotlib version."""
        return _MODULE_PREFIX + self.module_name

    @property
    def preferred_name(self) -> str:
        """
        The name to select this backend with.

        Prefers the short name (`positron-console` or `positron-notebook`): it's what
        `%matplotlib` prints, and users can round-trip it into
        `%matplotlib positron-console` or `matplotlib.use("positron-console")`. Falls
        back to `full_name` when the entry point isn't discoverable, which is always
        the case before matplotlib 3.9 since it has no backend registry.
        """
        registry = get_backend_registry()
        # `list_all` also loads the entry points, which `switch_backend` relies on having
        # been loaded to resolve the short name to a module. Loading them doesn't import
        # any backend module: matplotlib only reads each entry point's name and value
        # strings (see `backends/registry.py::_read_entry_points`), so this stays cheap
        # and can't trigger a premature self-activation.
        if registry and self.short_name in registry.list_all():
            return self.short_name
        return self.full_name

    def import_module(self) -> BackendModule:
        """Import this Positron matplotlib backend module."""
        return cast("BackendModule", importlib.import_module(self.module_name))


class BackendModule(Protocol):
    """Interface for Positron matplotlib backend modules."""

    def install(self, shell: InteractiveShell) -> None:
        """
        Install this backend's shell hooks.

        Never called twice without an intervening `uninstall`, so implementations hold
        no activation state of their own and needn't be idempotent.
        """
        ...

    def uninstall(self, shell: InteractiveShell) -> None:
        """
        Remove the shell hooks installed by `install`.

        Only ever called after a matching `install`, and before another backend's
        `install`.
        """
        ...
