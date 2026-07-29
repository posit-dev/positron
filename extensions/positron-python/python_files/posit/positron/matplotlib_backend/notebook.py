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

    # Sizing precedence:
    # 1. per-figure code (`plt.figure(figsize=...)` or `plt.subplots(figsize=...)`),
    #    which passes non-None figsize
    # 2. cell execute request (`#| fig-width`` and `#| fig-height`)
    # 3. matplotlib config (`plt.rcParams`)
    figsize = figsize or execute_request.figure_size
    figure = FigureClass(*args, figsize=figsize, **kwargs)

    # Also provide the execute request to the figure manager.
    manager: FigureManagerPositronNotebook = cast(
        "FigureManagerPositronNotebook", FigureCanvasPositronNotebook.new_manager(figure, num)
    )
    # Set the device pixel ratio to the execute request's value, if provided.
    if (pixel_ratio := execute_request.output_pixel_ratio) is not None:
        manager.canvas._set_device_pixel_ratio(pixel_ratio)  # type: ignore  # noqa: SLF001

    return manager


class FigureManagerPositronNotebook(FigureManagerBase):
    canvas: FigureCanvasPositronNotebook  # type: ignore

    def show(self):
        """Called by matplotlib when a figure is shown via `plt.show()` or `figure.show()`."""
        display(self.canvas.figure)

    @classmethod
    def pyplot_show(cls, *, block: bool | None = None) -> None:
        """Called by by matplotlib when a user calls `plt.show()`."""
        try:
            super().pyplot_show(block=block)
        finally:
            # Close all figures after showing them.
            if Gcf.get_all_fig_managers():
                plt.close("all")


class FigureCanvasPositronNotebook(FigureCanvasAgg):
    manager_class = FigureManagerPositronNotebook  # type: ignore


# Fulfil the matplotlib backend API.
FigureCanvas = FigureCanvasPositronNotebook
FigureManager = FigureManagerPositronNotebook


def _show_figures():
    """Post execute hook to show all figures and log errors."""
    try:
        return FigureManagerPositronNotebook.pyplot_show()
    except Exception:
        logger.exception("Error showing figures in post execute hook")


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
