#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#
"""
The matplotlib backend for Positron.

NOTE: DO NOT DIRECTLY IMPORT THIS MODULE!

This module assumes that it is only ever imported by matplotlib when it sets its backend.
Given that, it doesn't check whether matplotlib is installed in the user's environment,
and runs code on import e.g. to enable matplotlib interactive mode. This is the same approach
taken by IPython's matplotlib-inline backend, and seems to be the only way to run code when
the backend is set by matplotlib.
"""

from __future__ import annotations

import hashlib
import io
import logging
from typing import Optional, Union, cast

import matplotlib
from matplotlib._pylab_helpers import Gcf
from matplotlib.backend_bases import FigureManagerBase
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from .plots import Plot

logger = logging.getLogger(__name__)


# Enable interactive mode when this backend is used. See the note at the top of the file.
matplotlib.interactive(True)


class FigureManagerPositron(FigureManagerBase):
    """
    Interface for the matplotlib backend to interact with the Positron frontend.

    Parameters:
    -----------
    canvas
        The canvas for this figure.
    num
        The figure number.

    Attributes:
    -----------
    canvas
        The canvas for this figure.
    """

    canvas: FigureCanvasPositron

    def __init__(self, canvas: FigureCanvasPositron, num: Union[int, str]):
        from .positron_ipkernel import PositronIPyKernel

        super().__init__(canvas, num)

        self._plot: Optional[Plot] = None
        self._plots_service = cast(PositronIPyKernel, PositronIPyKernel.instance()).plots_service

    @property
    def is_visible(self) -> bool:
        """
        Whether the figure is visible to the frontend.
        """
        return self._plot is not None

    def show(self) -> None:
        """
        Called by matplotlib when a figure is shown via `plt.show()` or `figure.show()`.
        """
        if self._plot is None:
            # The frontend should respond with a render request, so there's no need for the explicit
            # show call in this case.
            self._plot = self._plots_service.create_plot(self.canvas._render, self._handle_close)
        else:
            self._plot.show()

    def destroy(self) -> None:
        """
        Called by matplotlib when a figure is closed via `plt.close()`.
        """
        if self._plot is not None:
            self._plots_service.close_plot(self._plot)

    def update(self) -> None:
        """
        Notify the frontend that the plot needs to be rerendered.

        Called by the canvas when a figure is drawn and its contents have changed.
        """
        if self._plot is None:
            logger.warning("Cannot update a plot that is not visible")
        else:
            self._plot.update()

    def _handle_close(self) -> None:
        """
        Called by the plots service after the plot is closed in the frontend.
        """
        # Notify matplotlib to close the figure (and its manager and canvas).
        Gcf.destroy(self)


class FigureCanvasPositron(FigureCanvasAgg):
    """
    The canvas for a figure in the Positron backend.

    Parameters:
    -----------
    figure
        The figure to draw on this canvas.

    Attributes:
    -----------
    manager
        The manager for this canvas.
    """

    manager: FigureManagerPositron

    manager_class = FigureManagerPositron  # type: ignore

    def __init__(self, figure: Optional[Figure] = None) -> None:
        super().__init__(figure)

        # Track the hash of the canvas contents for change detection.
        self._last_hash = ""

    def draw(self, is_rendering=False) -> None:
        """
        Draw the canvas; send an update event if the canvas has changed.

        Parameters:
        -----------
        is_rendering
            Whether the canvas is being rendered, to avoid recursively requesting an update from the
            frontend.
        """
        logger.debug("Drawing to canvas")
        try:
            super().draw()
        finally:
            if self.manager.is_visible and not is_rendering:
                current_hash = self._hash_buffer_rgba()
                logger.debug(f"Canvas: last hash: {self._last_hash[:6]}")
                logger.debug(f"Canvas: current hash: {current_hash[:6]}")
                if current_hash == self._last_hash:
                    logger.debug("Canvas: hash is the same, no need to render")
                else:
                    logger.debug("Canvas: hash changed, requesting a render")
                    self.manager.update()

    def _render(self, width_px: int, height_px: int, pixel_ratio: float, format: str) -> bytes:
        # Set the device pixel ratio to the requested value.
        self._set_device_pixel_ratio(pixel_ratio)  # type: ignore

        # This must be set before setting the size and can't be passed via print_figure else the
        # resulting size won't match the request size.
        self.figure.set_layout_engine("tight")

        # Resize the figure to the requested size in pixels.
        width_in = width_px * self.device_pixel_ratio / self.figure.dpi
        height_in = height_px * self.device_pixel_ratio / self.figure.dpi
        self.figure.set_size_inches(width_in, height_in, forward=False)

        # Render the canvas.
        figure_buffer = io.BytesIO()
        with io.BytesIO() as figure_buffer:
            self.print_figure(
                figure_buffer,
                format=format,
                dpi=self.figure.dpi,
            )
            rendered = figure_buffer.getvalue()

        # NOTE: For some reason, setting the layout engine earlier then calling print_figure
        #  requires this redraw before calculating the hash else the next draw() call will
        #  spuriously detect a change.
        self.draw(is_rendering=True)
        self._last_hash = self._hash_buffer_rgba()

        return rendered

    def _hash_buffer_rgba(self) -> str:
        """Hash the canvas contents for change detection."""
        return hashlib.sha1(self.buffer_rgba()).hexdigest()


# Fulfill the matplotlib backend API.
FigureCanvas = FigureCanvasPositron
FigureManager = FigureManagerPositron
