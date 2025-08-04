#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
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
from typing import TYPE_CHECKING, cast

import matplotlib
from matplotlib.backend_bases import FigureManagerBase
from matplotlib.backends.backend_agg import FigureCanvasAgg

if TYPE_CHECKING:
    from matplotlib.figure import Figure

    from .plot_comm import PlotSize

logger = logging.getLogger(__name__)


# Enable interactive mode (i.e. redraw after every plotting command).
# This is expected to run when the backend is selected. See the note at the top of the file.
matplotlib.interactive(True)  # noqa: FBT003


class FigureManagerPositron(FigureManagerBase):
    """
    Interface for the matplotlib backend to interact with the Positron frontend.

    Parameters
    ----------
    canvas
        The canvas for this figure.
    num
        The figure number.

    Attributes
    ----------
    canvas
        The canvas for this figure.
    """

    canvas: FigureCanvasPositron

    def __init__(self, canvas: FigureCanvasPositron, num: int | str):
        from .kernel.ipkernel import PositronIPythonKernel

        super().__init__(canvas, num)

        # Create the plot instance via the plots service.
        self._plots_service = cast(
            "PositronIPythonKernel", PositronIPythonKernel.instance()
        ).plots_service
        self._plot = self._plots_service.create_plot(canvas.render, canvas.intrinsic_size)

    @property
    def closed(self) -> bool:
        return self._plot.closed

    def show(self) -> None:
        """Called by matplotlib when a figure is shown via `plt.show()` or `figure.show()`."""
        self._plot.show()

    def destroy(self) -> None:
        """Called by matplotlib when a figure is closed via `plt.close()`."""
        self._plot.close()

    def update(self) -> None:
        """
        Notify the frontend that the plot needs to be rerendered.

        Called by the canvas when a figure is drawn and its contents have changed.
        """
        self._plot.update()


class FigureCanvasPositron(FigureCanvasAgg):
    """
    The canvas for a figure in the Positron backend.

    Parameters
    ----------
    figure
        The figure to draw on this canvas.

    Attributes
    ----------
    manager
        The manager for this canvas.
    """

    manager: FigureManagerPositron

    manager_class = FigureManagerPositron  # type: ignore

    def __init__(self, figure: Figure | None = None) -> None:
        super().__init__(figure)

        # Hash of the canvas contents after the previous render for change detection.
        self._previous_hash = ""

        # True after the canvas has been rendered at least once.
        self._first_render_completed = False

        # Store the intrinsic size of the figure.
        self.intrinsic_size = tuple(self.figure.get_size_inches())

    def draw(self, *, is_rendering=False) -> None:
        """
        Draw the canvas; send an update event if the canvas has changed.

        Parameters
        ----------
        is_rendering
            Whether the canvas is being rendered, to avoid an infinite draw-render loop with the
            frontend.
        """
        logger.debug("Drawing to canvas")
        try:
            super().draw()
        finally:
            # Do nothing if the canvas has not been rendered yet, to avoid an unnecessary update
            # since opening the comm will trigger a render from the frontend.
            if not self._first_render_completed:
                return  # noqa: B012

            # Do nothing if the canvas is currently being rendered, to avoid an infinite draw-render loop.
            if is_rendering:
                return  # noqa: B012

            # If the plot was closed after being opened, request an update to re-open the plot.
            if self.manager.closed:
                self.manager.update()
                return  # noqa: B012

            # Check if the canvas contents have changed, and request an update if they have.
            current_hash = self._hash_buffer_rgba()
            logger.debug(f"Canvas: previous hash: {self._previous_hash[:6]}")
            logger.debug(f"Canvas: current hash: {current_hash[:6]}")
            if current_hash == self._previous_hash:
                logger.debug("Canvas: hash is the same, no need to update")
                return  # noqa: B012

            logger.debug("Canvas: hash changed, requesting an update")
            self.manager.update()

    def render(self, size: PlotSize | None, pixel_ratio: float, format_: str) -> bytes:
        # Set the device pixel ratio to the requested value.
        self._set_device_pixel_ratio(pixel_ratio)  # type: ignore

        # Check if user has set layout engine for their plot. If layout engine is not "tight",
        # the resulting size may differ slightly from the request size. However, the layout engine
        # drastically changes the output, so we should respect the user's choice.
        if not self.figure.get_layout_engine():
            self.figure.set_layout_engine("tight")

        # Resize the figure to the requested size in pixels.
        if size is None:
            # If no size was provided, restore the figure to its intrinsic size.
            self.figure.set_size_inches(*self.intrinsic_size, forward=False)

            # Also use a tight bounding box. This guarantees that the image contains all elements in
            # the figure, but the size of the image is no longer guaranteed. It will match images
            # produced in Jupyter Notebooks which is probably what users expect.
            # See https://github.com/posit-dev/positron/issues/5068.
            bbox_inches = "tight"
        else:
            # If a specific size is requested, resize the image accordingly.
            width_in = size.width * self.device_pixel_ratio / self.figure.dpi
            height_in = size.height * self.device_pixel_ratio / self.figure.dpi
            self.figure.set_size_inches(width_in, height_in, forward=False)

            # Also disable the tight bounding box to guarantee the size of the image.
            bbox_inches = None

        # Render the canvas.
        with io.BytesIO() as figure_buffer:
            self.print_figure(
                figure_buffer,
                format=format_,
                dpi=self.figure.dpi,
                bbox_inches=bbox_inches,
            )
            rendered = figure_buffer.getvalue()

        # NOTE: For some reason, setting the layout engine earlier then calling print_figure
        #  requires this redraw before calculating the hash else the next draw() call will
        #  spuriously detect a change.
        self.draw(is_rendering=True)
        self._previous_hash = self._hash_buffer_rgba()
        self._first_render_completed = True

        return rendered

    def _hash_buffer_rgba(self) -> str:
        """Hash the canvas contents for change detection."""
        return hashlib.sha1(self.buffer_rgba()).hexdigest()


# Fulfill the matplotlib backend API.
FigureCanvas = FigureCanvasPositron
FigureManager = FigureManagerPositron
