#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
Positron's matplotlib backend for notebook sessions.

This backend is designed to match Jupyter's `matplotlib_inline` backend, except where deviating
would provide a better user experience in Positron.

NOTE: DO NOT DIRECTLY IMPORT THIS MODULE!

This module assumes that it is only ever imported by matplotlib when it sets its backend.
Given that, it doesn't check whether matplotlib is installed in the user's environment,
and runs code on import e.g. to enable matplotlib interactive mode. This is the same approach
taken by IPython's matplotlib-inline backend, and seems to be the only way to run code when
the backend is set by matplotlib.
"""

from __future__ import annotations

import contextlib
import logging
from typing import TYPE_CHECKING, Literal, cast

import matplotlib
import matplotlib.pyplot as plt
from IPython.display import display
from matplotlib._pylab_helpers import Gcf
from matplotlib.backend_bases import FigureManagerBase
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from ..execute_request import current_execute_request
from . import Backend, configure_positron_support, formats

if TYPE_CHECKING:
    from IPython.core.interactiveshell import InteractiveShell

logger = logging.getLogger(__name__)


def new_figure_manager(
    num: int | str,
    *args,
    FigureClass=Figure,  # noqa: N803
    # 3-tuple with unit is only available in matplotlib >= 3.11.
    figsize: tuple[float, float] | tuple[float, float, Literal["in", "cm", "px"]] | None = None,
    **kwargs,
) -> FigureManagerPositronNotebook:
    """Called by matplotlib when a new figure is created."""
    # Get the current execute request.
    execute_request = current_execute_request()

    # Sizing precedence: an explicit size from user code (`plt.figure(figsize=...)`,
    # `plt.subplots(figsize=...)`) wins, else the cell's `#| fig-width`/`#| fig-height`,
    # else matplotlib's `figure.figsize` rcParam, which `Figure` applies for a None figsize.
    figsize = figsize or execute_request.figure_size
    # `Figure` only accepts the 3-tuple form in matplotlib >= 3.11, but we pass whatever
    # matplotlib handed us straight back to it, so the pair always matches at runtime.
    # The cast keeps pyright quiet against the older pins (CI type-checks on 3.9).
    figure = FigureClass(*args, figsize=cast("tuple[float, float] | None", figsize), **kwargs)

    # Also provide the execute request to the figure manager.
    manager: FigureManagerPositronNotebook = cast(
        "FigureManagerPositronNotebook", FigureCanvasPositronNotebook.new_manager(figure, num)
    )
    # Set the device pixel ratio to the execute request's value, if provided.
    if (pixel_ratio := execute_request.output_pixel_ratio) is not None:
        manager.canvas.set_device_pixel_ratio(pixel_ratio)

    return manager


class FigureManagerPositronNotebook(FigureManagerBase):
    canvas: FigureCanvasPositronNotebook  # type: ignore

    # Whether this figure has already been displayed during the current cell. Only the
    # post-execute hook reads it, so an explicit show always displays. Public because
    # `_show_figures` reads it off another object.
    displayed = False

    def show(self):
        """Called by matplotlib when a figure is shown via `plt.show()` or `figure.show()`.

        Displays the figure inline, as an output of the currently executing cell.
        """
        display(self.canvas.figure)
        self.displayed = True

    @classmethod
    def pyplot_show(cls, *, block: bool | None = None) -> None:
        """Called by by matplotlib when a user calls `plt.show()`."""
        try:
            super().pyplot_show(block=block)
        finally:
            _close_all_figures()


class FigureCanvasPositronNotebook(FigureCanvasAgg):
    manager_class = FigureManagerPositronNotebook  # type: ignore

    def set_device_pixel_ratio(self, ratio: float) -> None:
        """Scale rendered pixels by `ratio`, leaving the figure's size in inches unchanged.

        A public seam over matplotlib's protected setter, since the ratio is applied by
        `new_figure_manager` from outside the canvas.
        """
        self._set_device_pixel_ratio(ratio)  # type: ignore


# Fulfil the matplotlib backend API.
FigureCanvas = FigureCanvasPositronNotebook
FigureManager = FigureManagerPositronNotebook


def _close_all_figures() -> None:
    """Close all figures, so that they don't accumulate across cells."""
    # `close("all")` triggers a gc collect, which can be slow, so skip it if there's
    # nothing to close.
    if Gcf.get_all_fig_managers():
        plt.close("all")


def _show_figures():
    """Post execute hook to show the cell's figures and log errors."""
    try:
        # Don't reuse `pyplot_show` here: it shows every figure, which would emit a second
        # output for a figure that user code already displayed via `plt.show()`/`fig.show()`.
        # Matplotlib's own loop adds nothing else for a non-GUI backend - it only handles
        # `NonGuiException` (our `show` displays instead of raising) and blocks on a main
        # loop we don't have.
        for manager in Gcf.get_all_fig_managers():
            if not isinstance(manager, FigureManagerPositronNotebook):
                manager.show()
                continue

            if not manager.displayed:
                manager.show()

            # Reset even though the figure is about to be closed: should one ever outlive
            # the cell, showing it again beats silently swallowing its output.
            manager.displayed = False
    except Exception:
        logger.exception("Error showing figures in post execute hook")
    finally:
        _close_all_figures()


def install(shell: InteractiveShell) -> None:
    """Install the notebook backend's shell hooks. See `BackendModule`."""
    # Register a hook to show all figures after cell execution.
    shell.events.register("post_execute", _show_figures)

    # Register our formatter(s) for matplotlib Figure objects, for the currently
    # selected format(s) (`png` unless the user previously called
    # `set_matplotlib_formats`).
    formats.apply_selected_formats(shell)


def uninstall(shell: InteractiveShell) -> None:
    """Remove the notebook backend's shell hooks. See `BackendModule`."""
    # Suppress ValueError in case user code unregistered the hook itself; a backend
    # switch shouldn't crash over it.
    with contextlib.suppress(ValueError):
        shell.events.unregister("post_execute", _show_figures)

    # Unregister our formatter(s) for matplotlib Figure objects.
    formats.pop_registered_formatters(shell)


# If we are the selected backend, activate through the registry, which also tears
# down the other flavor if it was active. This runs when matplotlib imports the
# module to switch to it. See the note at the top of the file. `Backend.from_name`
# matches both spellings, which matters here: matplotlib can still report our short
# name via `get_backend()` at this point, before it settles into the `module://`
# spelling.
if Backend.from_name(matplotlib.get_backend()) is Backend.NOTEBOOK:
    configure_positron_support(Backend.NOTEBOOK)
