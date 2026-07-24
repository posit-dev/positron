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

import io
import logging
from binascii import b2a_base64
from typing import TYPE_CHECKING, Literal

import matplotlib
import matplotlib.pyplot as plt
from IPython.core.getipython import get_ipython
from IPython.display import display
from matplotlib._pylab_helpers import Gcf
from matplotlib.backend_bases import FigureManagerBase
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from ..execute_request import PositronExecuteRequest, current_execute_request
from ..utils import png_pixel_size

if TYPE_CHECKING:
    from IPython.core.formatters import PNGFormatter
    from IPython.core.interactiveshell import InteractiveShell

logger = logging.getLogger(__name__)

BACKEND_NAME = "module://positron.matplotlib_backend.notebook"


def new_figure_manager(
    num: int | str,
    *args,
    FigureClass=Figure,  # noqa: N803
    # 3-tuple with unit is only available in matplotlib >= 3.11.
    figsize: tuple[int, int] | tuple[float, float, Literal["in", "cm", "px"]] | None = None,
    **kwargs,
) -> FigureManagerPositronNotebook:
    """Called by matplotlib when a new figure is created."""
    # Get the current execute request.
    execute_request = current_execute_request()

    # Prefer the user's explicit figsize (e.g. plt.figure(figsize=...) or plt.subplots(figsize=...))
    # over the execute request's figure size.
    figsize = figsize or execute_request.figure_size
    figure = FigureClass(*args, figsize=figsize, **kwargs)

    # Also provide the execute request to the figure manager.
    manager: FigureManagerPositronNotebook = FigureCanvasPositronNotebook.new_manager(figure, num)
    manager.set_execute_request(execute_request)

    return manager


class FigureManagerPositronNotebook(FigureManagerBase):
    canvas: FigureCanvasPositronNotebook

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

    def set_execute_request(self, execute_request: PositronExecuteRequest):
        """Set the current execute request."""
        self.execute_request = execute_request
        self.canvas.set_execute_request(execute_request)


class FigureCanvasPositronNotebook(FigureCanvasAgg):
    manager_class = FigureManagerPositronNotebook

    def set_execute_request(self, execute_request: PositronExecuteRequest) -> None:
        """Set the current execute request."""
        # Set the device pixel ratio to the execute request's value, if provided.
        if (pixel_ratio := execute_request.output_pixel_ratio) is not None:
            self._set_device_pixel_ratio(pixel_ratio)


def _display_figure(fig: Figure, *, format_="png") -> tuple[str, dict] | None:
    """Render a figure to its Jupyter display wire format."""
    # NOTE: This implementation must match `IPython.core.pylabtools.print_figure` otherwise
    #       users will get different results in Positron vs other notebook editors.

    # Don't display empty figures; mirrors IPython.
    if not fig.axes and not fig.lines:
        return None

    # Render the figure to bytes.
    canvas = fig.canvas
    with io.BytesIO() as figure_buffer:
        canvas.print_figure(
            figure_buffer,
            format=format_,
            # Must pass `fig.dpi` otherwise `print_figure` renders at a pixel ratio of 1.
            dpi=fig.dpi,
            # Tight bbox mirrors IPython.
            bbox_inches="tight",
        )
        data = figure_buffer.getvalue()

    # Decode bytes to string.
    if format_ == "svg":
        decoded = data.decode("utf-8")
    else:
        decoded = b2a_base64(data, newline=False).decode("ascii")

    # Prepare figure metadata.
    metadata = {}

    # If the canvas has a custom device pixel ratio, include the intended pixel size in the metadata.
    if (ratio := canvas.device_pixel_ratio) != 1:
        w, h = png_pixel_size(data)
        metadata["width"] = int(w) / ratio
        metadata["height"] = int(h) / ratio

    return decoded, metadata


# Fulfil the matplotlib backend API.
FigureCanvas = FigureCanvasPositronNotebook
FigureManager = FigureManagerPositronNotebook


def _get_png_formatter(shell: InteractiveShell) -> PNGFormatter:
    """Get the shell's PNG formatter."""
    return shell.display_formatter.formatters["image/png"]


def _show_figures():
    """Post execute hook to show all figures and log errors."""
    try:
        return FigureManagerPositronNotebook.pyplot_show()
    except Exception:
        logger.exception("Error showing figures in post execute hook")


def activate() -> None:
    """Activate the Positron matplotlib notebook backend."""
    shell = get_ipython()
    if shell is None:
        logger.warning("No IPython shell found; matplotlib notebook backend not activated")
        return

    # I think the only part of enable_matplotlib_integration that we really need
    # is to set interactive mode and to register the flush hook (below).
    matplotlib.interactive(True)  # noqa: FBT003

    # Register a hook to show all figures after cell execution.
    shell.events.register("post_execute", _show_figures)

    # Register our formatter for matplotlib Figure objects.
    _get_png_formatter(shell).for_type(Figure, _display_figure)


def deactivate() -> None:
    """Deactivate the Positron matplotlib notebook backend."""
    shell = get_ipython()
    if shell is None:
        logger.warning("No IPython shell found; matplotlib notebook backend not deactivated")
        return

    # Unregister the post execute hook.
    shell.events.unregister("post_execute", _show_figures)

    # Unregister our formatter for matplotlib Figure objects.
    png_formatter = _get_png_formatter(shell)
    try:
        if png_formatter.lookup(Figure) is _display_figure:
            # It's still our formatter, remove it.
            png_formatter.pop(Figure)
    except KeyError:
        # `lookup` raises if there's no formatter for the type, nothing to do.
        pass


# If we are the selected backend, activate.
# This is expected to run when the backend is selected. See the note at the top of the file.
if matplotlib.get_backend() == BACKEND_NAME:
    activate()
