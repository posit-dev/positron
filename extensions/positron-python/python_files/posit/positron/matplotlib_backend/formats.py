#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
Positron's support for `matplotlib_inline.backend_inline.set_matplotlib_formats`.

That function (and its sibling `select_figure_formats`) operate entirely inside
matplotlib-inline/IPython, with no Positron code on the stack, so the only way to
intercept them is to patch `set_matplotlib_formats` itself. The patch is installed
by `PositronBackendRegistry.activate` whenever a Positron backend (console or notebook)
is active, and removed once none is -- see `install_set_matplotlib_formats_patch` for
why a shared, call-time dispatch is needed instead of one patch per backend.

NOTE: only ever imported from `PositronBackendRegistry.activate`, by which point
matplotlib is guaranteed to be importable.
"""

from __future__ import annotations

import contextlib
import logging
from binascii import b2a_base64
from functools import partial
from typing import TYPE_CHECKING, Callable, cast

import matplotlib

# Same private helpers IPython's own retina path uses for identical metadata;
# stable for 10+ years.
from IPython.core.display import _jpegxy, _pngxy
from IPython.core.getipython import get_ipython
from IPython.core.pylabtools import print_figure
from matplotlib.figure import Figure

from .backend import Backend

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

# The pixel-size reader for each raster format's metadata. svg scales natively and
# pdf isn't rendered inline, so neither needs a pixel-size-derived `width`/`height`.
_PIXEL_SIZE_BY_FORMAT = {"png": _pngxy, "jpeg": _jpegxy}

# The formats currently selected; applied on the notebook backend's `install()` so the
# user's choice survives a round trip through a non-Positron backend (e.g.
# `%matplotlib qt` then back to `%matplotlib inline`).
_selected_formats: set[str] = {"png"}


def _formatters(shell: InteractiveShell):
    """The shell's mime-to-formatter mapping, asserting the display formatter exists."""
    assert shell.display_formatter is not None
    return shell.display_formatter.formatters


def _display_figure(
    fig: Figure, *, format_="png", **print_figure_kwargs
) -> tuple[str, dict] | None:
    """
    Render a figure to its Jupyter display wire format.

    Rendering is delegated to `IPython.core.pylabtools.print_figure` -- the function
    IPython's own inline formatters wrap -- so output matches other Jupyter frontends
    (empty-figure suppression, kwarg precedence, facecolor handling, dpi). On top of
    that, Positron attaches the intended logical size as metadata when rendering at a
    device pixel ratio other than 1.
    """
    # `bbox_inches="tight"` is `print_figure`'s own default; deliberately not passed
    # here so a user-supplied `bbox_inches` in `print_figure_kwargs` can't collide
    # with a duplicate keyword.
    data = print_figure(fig, fmt=format_, **print_figure_kwargs)
    if data is None:
        # Empty figure: display nothing, mirroring IPython.
        return None

    # svg comes back as an already-decoded string and scales natively, so it carries
    # no size metadata; everything else is raw bytes to base64-encode.
    if format_ == "svg":
        # `print_figure` returns `str` only for svg; narrowed by the `format_` check above.
        return cast("str", data), {}
    # Same encoding `print_figure(base64=True)` would have applied, done here instead so
    # the raw bytes stay available for `_pngxy`/`_jpegxy` below.
    decoded = b2a_base64(cast("bytes", data), newline=False).decode("ascii")

    metadata = {}
    pixel_size = _PIXEL_SIZE_BY_FORMAT.get(format_)
    if pixel_size is not None and (ratio := fig.canvas.device_pixel_ratio) != 1:
        w, h = pixel_size(cast("bytes", data))
        metadata["width"] = int(w) / ratio
        metadata["height"] = int(h) / ratio

    return decoded, metadata


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

    for requested in formats:
        normalized = _FORMAT_ALIASES.get(requested, requested)
        mime = _MIME_BY_FORMAT[normalized]
        callable_ = partial(_display_figure, format_=normalized, **print_figure_kwargs)
        _formatters(shell)[mime].for_type(Figure, callable_)

    _selected_formats.clear()
    _selected_formats.update(formats)


def apply_selected_formats(shell: InteractiveShell) -> None:
    """Register the currently selected formats. Called by the notebook backend's `install`."""
    select_figure_formats(shell, _selected_formats)


def pop_registered_formatters(shell: InteractiveShell) -> None:
    """Unregister the formatters `select_figure_formats` registered. Called by `uninstall`."""
    for formatter in _formatters(shell).values():
        # `lookup_by_type` raises KeyError if there's no formatter for the type.
        with contextlib.suppress(KeyError):
            current = formatter.lookup_by_type(Figure)
            if isinstance(current, partial) and current.func is _display_figure:
                # It's still ours (a `partial` binding `_display_figure`), remove it.
                formatter.pop(Figure)


# The original and installed `set_matplotlib_formats`, so `uninstall_...` can undo
# `install_...`.
_original_set_matplotlib_formats: Callable | None = None
_installed_set_matplotlib_formats: Callable | None = None


def install_set_matplotlib_formats_patch() -> None:
    """
    Patch `matplotlib_inline.backend_inline.set_matplotlib_formats`. Safe to call repeatedly.

    Installed by `PositronBackendRegistry.activate` whenever a Positron backend is
    active, and dispatches at call time on `matplotlib.get_backend()`, so it stays
    correct however the active backend changes between install and call time.
    Dispatching on
    the live backend string rather than the registry's state is deliberate: a user can
    switch backends with a bare `matplotlib.use(...)` that never goes through the
    registry.
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
            # `%config InlineBackend.*` no-op precedent (see test_enable_matplotlib.py).
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

    import matplotlib_inline.backend_inline as backend_inline

    # Only restore if our patch is still installed; something else may have patched
    # over it since, in which case we leave that patch alone.
    if backend_inline.set_matplotlib_formats is _installed_set_matplotlib_formats:
        backend_inline.set_matplotlib_formats = _original_set_matplotlib_formats

    _original_set_matplotlib_formats = None
    _installed_set_matplotlib_formats = None
