#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
Positron's matplotlib backends.

Positron ships one backend per session mode, each registered under its own short name
(`positron-console`, `positron-notebook`) via the `matplotlib.backend` entry point in
`python_files/posit/positron_matplotlib-<version>.dist-info`.
This module holds the names they share and the switch-time lifecycle called by
`PositronShell.enable_matplotlib`.

Keep this module free of matplotlib imports. It's imported by the kernel, which must
work in environments without matplotlib installed; the backend modules are imported
lazily, and only once they're actually needed.
"""

from __future__ import annotations

import importlib
import logging
from enum import Enum
from typing import TYPE_CHECKING, Protocol, cast

from IPython.core.getipython import get_ipython

from ..session_mode import SessionMode

if TYPE_CHECKING:
    from IPython.core.interactiveshell import InteractiveShell

logger = logging.getLogger(__name__)

_MODULE_PREFIX = "module://"


class Backend(Enum):
    """
    One of Positron's matplotlib backends, and the names that select it.

    `short_name` is the name registered via the `matplotlib.backend` entry point;
    `full_name` is matplotlib's `module://` spelling of `module_name`. Both select the
    same backend: matplotlib resolves the short name through its backend registry
    (matplotlib >= 3.9), while the `module://` spelling works on any version.
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
        registry = _get_backend_registry()
        # `list_all` also loads the entry points, which `switch_backend` relies on having
        # been loaded to resolve the short name to a module.
        if registry and self.short_name in registry.list_all():
            return self.short_name
        return self.full_name

    def import_module(self) -> BackendModule:
        """Import this Positron matplotlib backend module."""
        return cast("BackendModule", importlib.import_module(self.module_name))


class BackendModule(Protocol):
    """
    The hooks each Positron backend module implements.

    Called only by `configure_positron_support`, which owns activation state and
    guarantees pairing and ordering: the previously active backend is uninstalled
    before the next one is installed. `install` and `uninstall` are therefore not
    idempotent and hold no activation state of their own.
    """

    def install(self, shell: InteractiveShell) -> None: ...

    def uninstall(self, shell: InteractiveShell) -> None: ...


def register_with_legacy_ipython() -> None:
    """
    Make Positron's short names visible to IPython versions without registry support.

    IPython 8.24 started resolving `%matplotlib <name>` and building `%matplotlib -l`
    from matplotlib's backend registry (matplotlib >= 3.9), which discovers Positron's
    backends through their entry points. Earlier IPython reads the static
    `pylabtools.backends` table for both, so add the short names there. Uses the
    `module://` spelling as the value so the entries resolve on any matplotlib version.
    """
    from IPython.core import pylabtools as pt

    # The registry-based lister arrived in the same release that stopped reading the
    # static table, so its presence tells the two resolution schemes apart. Touching
    # `pt.backends` on newer IPython would also trip its deprecation warning.
    if hasattr(pt, "_list_matplotlib_backends_and_gui_loops"):
        return
    for backend in Backend:
        pt.backends.setdefault(backend.short_name, backend.full_name)


def _get_backend_registry():
    """The matplotlib backend registry, or None if matplotlib < 3.9."""
    try:
        from matplotlib.backends.registry import backend_registry

        return backend_registry
    except ImportError:
        # No backend registry before matplotlib 3.9.
        return None


# The Positron backend whose hooks are currently installed. Owned exclusively by
# `configure_positron_support`; backend modules hold no activation state of their own.
_active_backend: Backend | None = None


def configure_positron_support(backend: str | Backend) -> None:
    """
    Activate or deactivate Positron's matplotlib backend for a switch to `backend`.

    Mirrors `matplotlib_inline.backend_inline.configure_inline_support`, the de facto
    IPython interface for switch-time lifecycle: called on every backend switch, and
    self-dispatching on whether the new backend is its own.

    Sole owner of activation state: the previously active backend's hooks are
    uninstalled before the new backend's are installed, and a switch to the already
    active backend is a no-op.
    """
    global _active_backend

    target = backend if isinstance(backend, Backend) else Backend.from_name(backend)
    if target is _active_backend:
        return

    shell = get_ipython()
    if shell is None:
        logger.warning("No IPython shell found; Positron matplotlib support not configured")
        return

    if _active_backend is not None:
        _active_backend.import_module().uninstall(shell)
        _active_backend = None

    if target is not None:
        # Enable interactive mode (i.e. redraw after every plotting command).
        import matplotlib

        matplotlib.interactive(True)  # noqa: FBT003
        target.import_module().install(shell)
        _active_backend = target
