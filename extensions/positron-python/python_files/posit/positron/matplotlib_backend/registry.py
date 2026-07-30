#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
Which Positron matplotlib backend is active, and the switch-time lifecycle around it.

Keep this module free of matplotlib imports; see the package docstring.
"""

from __future__ import annotations

import logging
import sys
from typing import TYPE_CHECKING, Callable

from IPython.core.getipython import get_ipython

from .backend import Backend

if TYPE_CHECKING:
    from IPython.core.interactiveshell import InteractiveShell

    ConfigureInlineSupport = Callable[[InteractiveShell, str], None]

logger = logging.getLogger(__name__)

_MATPLOTLIB_INLINE_MODULE = "matplotlib_inline.backend_inline"
_MATPLOTLIB_INLINE_BACKENDS = ("inline", f"module://{_MATPLOTLIB_INLINE_MODULE}")


def _needs_inline_support(shell: InteractiveShell, backend: str) -> bool:
    """
    Whether matplotlib-inline's `configure_inline_support` should be called for `backend`.

    Only when matplotlib-inline is the backend being switched to, or when it's currently
    active and needs tearing down. Calling it in any other case would instantiate
    `InlineBackend` into `shell.configurables`, arming a traitlets observer that re-runs
    `select_figure_formats` -- popping Positron's figure formatter -- on any later
    `%config InlineBackend.*` assignment.
    """
    if backend in _MATPLOTLIB_INLINE_BACKENDS:
        return True

    # matplotlib-inline is active if its post execute hook is registered, whether by an
    # earlier switch through here or by its backend module self-activating on import.
    module = sys.modules.get(_MATPLOTLIB_INLINE_MODULE)
    flush_figures = getattr(module, "flush_figures", None)
    return flush_figures is not None and flush_figures in shell.events.callbacks.get(
        "post_execute", []
    )


class PositronBackendRegistry:
    """
    Sole owner of which Positron matplotlib backend is active.

    Instantiated once as the module-level `registry`, mirroring matplotlib's own
    `backend_registry`: a process has a single active matplotlib backend, so it has a
    single activation state. Backend modules hold no activation state of their own.
    """

    def __init__(self) -> None:
        # The Positron backend whose hooks are currently installed.
        self._active_backend: Backend | None = None

        # The real `configure_inline_support`, captured when the switch hook is installed.
        self._original_configure_inline_support: ConfigureInlineSupport | None = None

    def activate(self, backend: str | Backend) -> None:
        """
        Activate the Positron backend that `backend` selects, deactivating the previous one.

        Called on every matplotlib backend switch and self-dispatching on whether the
        new backend is one of ours, so a `backend` that isn't Positron's deactivates
        Positron's support entirely. Switching to the already active backend is a no-op.
        """
        target = backend if isinstance(backend, Backend) else Backend.from_name(backend)
        if target is self._active_backend:
            return

        shell = get_ipython()
        if shell is None:
            logger.warning("No IPython shell found; Positron matplotlib support not configured")
            return

        if self._active_backend is not None:
            # `_active_backend` is only ever set after we imported that module and
            # installed its hooks, so this `import_module()` is a cached `sys.modules`
            # lookup rather than a fresh import.
            self._active_backend.import_module().uninstall(shell)
            self._active_backend = None

        if target is not None:
            # Enable interactive mode (i.e. redraw after every plotting command).
            import matplotlib

            matplotlib.interactive(True)  # noqa: FBT003
            target.import_module().install(shell)
            self._active_backend = target

        # The `set_matplotlib_formats` patch is installed once for any Positron backend
        # rather than per backend (it dispatches on the live backend at call time), so
        # it's owned here: installed while any Positron backend is active, removed when
        # none is.
        from . import formats

        if target is not None:
            formats.install_set_matplotlib_formats_patch()
        else:
            formats.uninstall_set_matplotlib_formats_patch()

    def install_switch_hook(self) -> ConfigureInlineSupport:
        """
        Wrap `matplotlib_inline.backend_inline.configure_inline_support` with Positron's seam.

        IPython's `enable_matplotlib` imports that function from the module at call time
        on every backend switch, so wrapping the module attribute makes every switch --
        including ones to foreign backends via `super()` -- run
        `configure_matplotlib_support`. It also covers the switch that never reaches
        `enable_matplotlib` at all: `matplotlib_inline.backend_inline` self-activates at
        import (`_enable_matplotlib_integration`) and calls `configure_inline_support`
        directly, so a bare `matplotlib.use("inline")` only goes through Positron here.

        Idempotent, and returns the real `configure_inline_support` the seam wraps.
        Installed lazily (not at kernel init) because importing matplotlib_inline pulls
        in matplotlib, which may not be installed until the user actually plots. Never
        uninstalled, matching the kernel's other third-party patches; the wrapper
        preserves upstream behavior whenever Positron isn't involved.
        """
        if self._original_configure_inline_support is None:
            import matplotlib_inline.backend_inline as backend_inline

            self._original_configure_inline_support = backend_inline.configure_inline_support
            backend_inline.configure_inline_support = configure_matplotlib_support
        return self._original_configure_inline_support

    def configure_switch(self, shell: InteractiveShell, backend: str) -> None:
        """
        Configure inline figure display after a matplotlib backend switch.

        matplotlib-inline is configured only when it's involved (see
        `_needs_inline_support`): calling it for any other switch would instantiate
        `InlineBackend` into `shell.configurables`, arming a traitlets observer that pops
        Positron's figure formatter on any later `%config InlineBackend.*` assignment.
        Positron's support is configured on every switch, and goes last: tearing down
        matplotlib-inline re-runs `select_figure_formats`, which pops the figure formatter
        that activating Positron's backend then registers.
        """
        original_configure_inline_support = self.install_switch_hook()
        if _needs_inline_support(shell, backend):
            original_configure_inline_support(shell, backend)
        self.activate(backend)


registry = PositronBackendRegistry()


def install_backend_switch_hook() -> None:
    """Install `registry`'s switch hook. See `PositronBackendRegistry.install_switch_hook`."""
    registry.install_switch_hook()


def configure_matplotlib_support(shell: InteractiveShell, backend: str) -> None:
    """
    Configure Positron's matplotlib support after a backend switch.

    The name and signature mirror `matplotlib_inline.backend_inline.configure_inline_support`,
    the de facto IPython interface for switch-time lifecycle, since this replaces it. A
    module-level function rather than a bound method so the object installed by
    `PositronBackendRegistry.install_switch_hook` is stable and comparable by identity.
    See `PositronBackendRegistry.configure_switch`.
    """
    registry.configure_switch(shell, backend)
