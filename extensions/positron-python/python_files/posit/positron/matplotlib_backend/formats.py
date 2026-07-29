#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
Positron's support for `matplotlib_inline.backend_inline.set_matplotlib_formats`.

That function (and its sibling `select_figure_formats`) operate entirely inside
matplotlib-inline/IPython, with no Positron code on the stack, so the only way to
intercept them is to patch `set_matplotlib_formats` itself. Both of Positron's
matplotlib backend flavors (console, notebook) install the *same* patch and leave it
dispatching at call time on whichever flavor is currently the active matplotlib
backend -- see `install_set_matplotlib_formats_patch` for why a shared, call-time
dispatch is needed instead of one patch per flavor.

NOTE: only ever imported from a flavor's `activate`/`deactivate`, by which point
matplotlib is guaranteed to be importable.
"""

from __future__ import annotations

import logging
import sys
from functools import partial
from typing import TYPE_CHECKING, Callable

import matplotlib
from IPython.core.getipython import get_ipython
from matplotlib.figure import Figure

from . import Backend

if TYPE_CHECKING:
    from IPython.core.interactiveshell import InteractiveShell

logger = logging.getLogger(__name__)

# Formats accepted by `set_matplotlib_formats`, matching IPython's
# `select_figure_formats`. `retina`/`png2x` alias to `png`: Positron already renders at
# the frontend's device pixel ratio, so pixel-doubling is subsumed by that instead of
# IPython's dpi-doubling. `jpg` aliases to `jpeg`, the name Positron's formatter/mime
# tables use.
_FORMAT_ALIASES = {"retina": "png", "png2x": "png", "jpg": "jpeg"}
_MIME_BY_FORMAT = {
    "png": "image/png",
    "jpeg": "image/jpeg",
    "svg": "image/svg+xml",
    "pdf": "application/pdf",
}
# The formats IPython's `select_figure_formats` accepts; anything else is a `ValueError`.
_SUPPORTED_FORMATS = frozenset({"png", "retina", "png2x", "jpg", "jpeg", "svg", "pdf"})

# The formats currently selected; applied on the notebook backend's `activate()` so the
# user's choice survives a round trip through a non-Positron backend (e.g.
# `%matplotlib qt` then back to `%matplotlib inline`).
_selected_formats: set[str] = {"png"}

# The (mime type, formatter callable) pairs registered by the last `select_figure_formats`
# call, so `pop_registered_formatters` pops exactly ours and nothing else.
_registered: list[tuple[str, Callable]] = []


def _formatters(shell: InteractiveShell):
    """The shell's mime-to-formatter mapping, asserting the display formatter exists."""
    assert shell.display_formatter is not None
    return shell.display_formatter.formatters


def select_figure_formats(shell: InteractiveShell, formats, **print_figure_kwargs) -> None:
    """
    Positron's mirror of `IPython.core.pylabtools.select_figure_formats`.

    Registers Positron's `_display_figure` (as a `partial` binding `format_` and any
    `print_figure_kwargs`) on the display formatter for each requested format, so
    figures keep going through Positron's DPR-aware rendering no matter which format
    the user asked for.

    Unlike upstream, unsupported formats are validated before any formatter is
    touched, so a typo (e.g. `'bmp'`) leaves a previously working selection in place
    instead of clobbering it.
    """
    # Imported lazily: `notebook` imports this module at top level, so importing it
    # back here at module scope would be circular. By call time both modules are
    # fully loaded.
    from .notebook import _display_figure

    if isinstance(formats, str):
        formats = {formats}
    formats = set(formats)

    unsupported = formats - _SUPPORTED_FORMATS
    if unsupported:
        supported_str = ",".join(repr(f) for f in sorted(_SUPPORTED_FORMATS))
        unsupported_str = ",".join(repr(f) for f in sorted(unsupported))
        raise ValueError(f"supported formats are: {supported_str} not {unsupported_str}")

    # Pop `Figure` from every display formatter, mirroring upstream -- this also
    # cleans up leftovers if IPython's own formatters somehow got installed (e.g.
    # before this patch was in place).
    for formatter in _formatters(shell).values():
        formatter.pop(Figure, None)
    _registered.clear()

    for requested in formats:
        normalized = _FORMAT_ALIASES.get(requested, requested)
        mime = _MIME_BY_FORMAT[normalized]
        callable_ = partial(_display_figure, format_=normalized, **print_figure_kwargs)
        _formatters(shell)[mime].for_type(Figure, callable_)
        _registered.append((mime, callable_))

    _selected_formats.clear()
    _selected_formats.update(formats)


def apply_selected_formats(shell: InteractiveShell) -> None:
    """Register the currently selected formats. Called by the notebook backend's `activate`."""
    select_figure_formats(shell, _selected_formats)


def pop_registered_formatters(shell: InteractiveShell) -> None:
    """Unregister the formatters `select_figure_formats` registered. Called by `deactivate`."""
    for mime, callable_ in _registered:
        formatter = _formatters(shell)[mime]
        try:
            if formatter.lookup_by_type(Figure) is callable_:
                # It's still ours, remove it.
                formatter.pop(Figure)
        except KeyError:
            # `lookup_by_type` raises if there's no formatter for the type, nothing to do.
            pass
    _registered.clear()


# The original and installed `set_matplotlib_formats`, so `uninstall_...` can undo
# `install_...`.
_original_set_matplotlib_formats: Callable | None = None
_installed_set_matplotlib_formats: Callable | None = None


def install_set_matplotlib_formats_patch() -> None:
    """
    Patch `matplotlib_inline.backend_inline.set_matplotlib_formats`. Safe to call repeatedly.

    The patch is shared by both flavors and dispatches at call time on
    `matplotlib.get_backend()`, rather than being installed/uninstalled per flavor.
    `configure_positron_support` iterates flavors in a fixed order, so on e.g. a
    notebook -> console switch the new flavor's activate runs before the old flavor's
    deactivate; a per-flavor install/uninstall would have that deactivate unpatch the
    patch the activate just installed.
    """
    global _original_set_matplotlib_formats, _installed_set_matplotlib_formats
    if _installed_set_matplotlib_formats is not None:
        return

    import matplotlib_inline.backend_inline as backend_inline

    original = backend_inline.set_matplotlib_formats
    _original_set_matplotlib_formats = original

    def set_matplotlib_formats(*formats, **kwargs) -> None:
        shell = get_ipython()
        target = Backend.from_name(matplotlib.get_backend())
        if shell is not None and target is Backend.NOTEBOOK:
            select_figure_formats(shell, formats, **kwargs)
        elif target is Backend.CONSOLE:
            # The Plots pane negotiates its own format via `canvas.render(format_=...)`;
            # running `select_figure_formats` here would emit stray inline outputs
            # alongside it. Silent no-op, matching the deliberate
            # `%config InlineBackend.*` no-op precedent (see test_switching.py).
            logger.debug("set_matplotlib_formats is a no-op in Positron's console backend")
        else:
            # A non-Positron backend is active (e.g. the user called
            # `matplotlib.use('agg')` directly); defer to the original so its
            # behavior is unaffected.
            original(*formats, **kwargs)

    backend_inline.set_matplotlib_formats = set_matplotlib_formats
    _installed_set_matplotlib_formats = set_matplotlib_formats


def uninstall_set_matplotlib_formats_patch() -> None:
    """Restore the original `set_matplotlib_formats`. Safe to call repeatedly."""
    global _original_set_matplotlib_formats, _installed_set_matplotlib_formats
    if _installed_set_matplotlib_formats is None:
        return

    if _any_flavor_active():
        # Another flavor is still active; leave the shared patch installed for it.
        return

    import matplotlib_inline.backend_inline as backend_inline

    # Only restore if our patch is still installed; something else may have patched
    # over it since, in which case we leave that patch alone.
    if backend_inline.set_matplotlib_formats is _installed_set_matplotlib_formats:
        backend_inline.set_matplotlib_formats = _original_set_matplotlib_formats

    _original_set_matplotlib_formats = None
    _installed_set_matplotlib_formats = None


def _any_flavor_active() -> bool:
    """Whether either of Positron's matplotlib backend flavors is currently active."""
    for candidate in Backend:
        # Only check a module that's already imported: one that was never imported
        # was never active, and importing it now would self-activate it for nothing.
        module = sys.modules.get(candidate.module_name)
        if module is not None and getattr(module, "_active", False):
            return True
    return False
