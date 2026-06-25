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
import inspect
import io
import logging
from typing import TYPE_CHECKING, Any, cast

import matplotlib
import matplotlib.pyplot as plt
from matplotlib.backend_bases import FigureManagerBase
from matplotlib.backends.backend_agg import FigureCanvasAgg

if TYPE_CHECKING:
    from matplotlib.figure import Figure

    from .plot_comm import PlotSize

logger = logging.getLogger(__name__)


# Enable interactive mode (i.e. redraw after every plotting command).
# This is expected to run when the backend is selected. See the note at the top of the file.
matplotlib.interactive(True)  # noqa: FBT003


# High-level libraries that build on matplotlib. A figure produced by one of these is
# attributed to that library (used for the plot's display name and, for seaborn,
# detached after each cell; see `detach_library_figures`).
_LIBRARY_MODULE_ROOTS = ("seaborn", "plotnine")

# Kinds whose figures are detached from matplotlib's global registry after each
# interactive cell. Limited to seaborn: its axes-level functions (heatmap,
# scatterplot, ...) draw onto the current axes, so re-running stacks elements (e.g.
# colorbars) onto the previous figure. Plain matplotlib is intentionally left
# persistent so a plot can be updated or re-shown across cells.
# See https://github.com/posit-dev/positron/issues/8898.
_DETACH_AFTER_CELL_KINDS = frozenset({"seaborn"})


def _detect_plotting_library() -> str:
    """
    Detect the high-level plotting library that created the current figure.

    Walks the call stack, which still contains the creating library's frames since
    this runs during figure creation, and returns the most specific known library.
    This is more precise than checking ``sys.modules``, which would misattribute a
    plain matplotlib figure to seaborn whenever seaborn is merely imported (for
    example via ``sns.set_theme()``).
    """
    frame = inspect.currentframe()
    try:
        while frame is not None:
            module_root = frame.f_globals.get("__name__", "").split(".", 1)[0]
            if module_root in _LIBRARY_MODULE_ROOTS:
                return module_root
            frame = frame.f_back
    finally:
        # Break the local reference to the frame to avoid creating a reference cycle.
        del frame

    return "matplotlib"


def detach_library_figures() -> None:
    """
    Detach high-level library figures (e.g. seaborn) from matplotlib's global registry.

    Called after each interactive cell. The figures are only removed from the registry,
    not destroyed: the comm and cached render stay alive (``FigureManagerPositron.destroy``
    is a no-op and the figure is still referenced by the plots service), so the plot
    remains visible in the Plots pane and can still be re-rendered on resize. Removing
    them from the registry means the next execution starts with a fresh figure instead of
    drawing onto the previous one, avoiding duplicated elements such as stacked colorbars.
    See https://github.com/posit-dev/positron/issues/8898.

    Plain matplotlib figures are intentionally left in the registry to preserve Positron's
    cross-cell figure persistence (updating or re-showing a plot across cells).
    """
    from matplotlib._pylab_helpers import Gcf

    for manager in list(Gcf.get_all_fig_managers()):
        if (
            isinstance(manager, FigureManagerPositron)
            and manager.plotting_library in _DETACH_AFTER_CELL_KINDS
        ):
            # Removes the manager from the registry and invokes our no-op `destroy`.
            Gcf.destroy(manager.num)


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
        from .plot_comm import PlotOrigin, PlotRange
        from .positron_ipkernel import PositronIPyKernel

        super().__init__(canvas, num)

        kernel = cast("PositronIPyKernel", PositronIPyKernel.instance())

        # Get the execution context from the current shell message
        parent = kernel.get_parent("shell")
        header: dict[str, Any] = cast("dict[str, Any]", parent.get("header", {}))
        content: dict[str, Any] = cast("dict[str, Any]", parent.get("content", {}))
        execution_id: str = header.get("msg_id", "")
        code: str = content.get("code", "")

        # Extract code_location from the positron metadata, if present
        positron_meta = content.get("positron", {})
        code_location = positron_meta.get("code_location", None) if positron_meta else None

        origin: PlotOrigin | None = None
        if code_location:
            loc_range = code_location.get("range", {})
            start = loc_range.get("start", {})
            end = loc_range.get("end", {})
            origin = PlotOrigin(
                uri=code_location["uri"],
                range=PlotRange(
                    start_line=start.get("line", 0),
                    start_character=start.get("character", 0),
                    end_line=end.get("line", 0),
                    end_character=end.get("character", 0),
                ),
            )

        # Detect which plotting library was used. Stored so `detach_library_figures`
        # can decide whether this figure should be detached after each cell.
        kind = _detect_plotting_library()
        self.plotting_library = kind

        # Create the plot instance via the plots service.
        self._plots_service = kernel.plots_service
        self._plot = self._plots_service.create_plot(
            canvas.render,
            canvas.intrinsic_size,
            kind,
            execution_id,
            code,
            num,
            self._on_close,
            origin,
        )

    def _on_close(self) -> None:
        """
        Close the matplotlib figure when the plot is closed.

        This ensures matplotlib's internal figure cache is cleared when the frontend
        closes the plot, preventing figures from being restored when the comm reopens.

        Close by figure object rather than by number: `detach_library_figures` removes
        figures from the registry, freeing their numbers for matplotlib to reuse, so
        closing by number could destroy a different figure that reused this number.
        Closing an already-detached figure is a safe no-op.
        """
        plt.close(self.canvas.figure)

    @property
    def closed(self) -> bool:
        return self._plot.closed

    def show(self) -> None:
        """Called by matplotlib when a figure is shown via `plt.show()` or `figure.show()`."""
        self._plot.show()

    def destroy(self) -> None:
        """Called by matplotlib after a figure is closed via `plt.close()`.

        We intentionally don't close the comm here. Matplotlib has already destroyed
        the figure before calling this method. We keep the comm open so the plot
        remains visible in the plots pane with its cached render. This avoids race
        conditions where RPC calls (render, get_intrinsic_size) fail because the comm
        was closed before the frontend finished processing.

        The comm will be closed when:
        - The user removes the plot from history
        - The session ends
        """

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


_library_gca_redirect_installed = False


def _install_library_gca_redirect() -> None:
    """
    Make a high-level library (e.g. seaborn) draw on a fresh figure instead of an
    existing one created by a different library.

    Seaborn's axes-level functions draw on `plt.gca()` when no `ax=` is given. With a
    persistent figure registry, that current figure may be a leftover from a different
    library (for example a matplotlib plot from an earlier cell), so seaborn would draw
    over it. We intercept `plt.gca()`: when a library on the call stack differs from the
    library that created the active figure, return the axes of a fresh figure instead.

    This only affects the implicit `plt.gca()` path -- an explicit `ax=` is untouched --
    and only fires across libraries, so plain matplotlib figures remain reusable
    (preserving cross-cell persistence). See https://github.com/posit-dev/positron/issues/8898.
    """
    global _library_gca_redirect_installed
    if _library_gca_redirect_installed:
        return

    import matplotlib.pyplot as plt
    from matplotlib._pylab_helpers import Gcf

    original_gca = plt.gca

    def gca(*args, **kwargs):
        manager = Gcf.get_active()
        if (
            isinstance(manager, FigureManagerPositron)
            and manager.plotting_library not in _DETACH_AFTER_CELL_KINDS
            and _detect_plotting_library() in _DETACH_AFTER_CELL_KINDS
        ):
            # Drawing library differs from the active figure's library: start fresh so
            # the existing figure isn't overwritten.
            return plt.figure().gca()
        return original_gca(*args, **kwargs)

    plt.gca = gca
    _library_gca_redirect_installed = True


_install_library_gca_redirect()


# Fulfill the matplotlib backend API.
FigureCanvas = FigureCanvasPositron
FigureManager = FigureManagerPositron
