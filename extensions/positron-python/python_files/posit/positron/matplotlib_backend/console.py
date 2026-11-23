#
# Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
Positron's matplotlib backend for console sessions.

NOTE: DO NOT DIRECTLY IMPORT THIS MODULE!

This module assumes that it is only ever imported by matplotlib when it sets its backend.
Given that, it doesn't check whether matplotlib is installed in the user's environment,
and runs code on import e.g. to enable matplotlib interactive mode. This is the same approach
taken by IPython's matplotlib-inline backend, and seems to be the only way to run code when
the backend is set by matplotlib.
"""

from __future__ import annotations

import contextlib
import hashlib
import inspect
import io
import logging
import re
import warnings
import weakref
from typing import TYPE_CHECKING, cast

import matplotlib
import matplotlib.pyplot as plt
from matplotlib.backend_bases import FigureManagerBase
from matplotlib.backends.backend_agg import FigureCanvasAgg

from ..execute_request import current_execute_request
from .backend import Backend
from .registry import registry

if TYPE_CHECKING:
    from IPython.core.interactiveshell import ExecutionInfo, InteractiveShell
    from matplotlib.figure import Figure

    from ..plot_comm import PlotSize
    from ..plots import Plot

logger = logging.getLogger(__name__)


# High-level libraries that build on matplotlib. A figure produced by one of these is
# attributed to that library (used for the plot's display name and, for seaborn,
# detached after each cell; see `detach_library_figures`).
_LIBRARY_MODULE_ROOTS = ("seaborn", "plotnine", "holoviews")

# Kinds whose figures don't get a plot from this backend. HoloViews opens its own plot in the
# Plots pane (see `patch/holoviews.py`), and also creates figures for `hv.save`.
_NO_PLOT_KINDS = frozenset({"holoviews"})

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


def _detach_figures(*, library_kinds: frozenset[str] | None = None) -> None:
    """
    Detach Positron figures from matplotlib's global registry.

    The figures are only removed from the registry, not destroyed: the comm and cached
    render stay alive (``FigureManagerPositron.destroy`` is a no-op and the figure is still
    referenced by the plots service), so the plot remains visible in the Plots pane and
    can still be re-rendered on resize. The next plotting command starts a fresh figure
    instead of drawing onto a previous one. Edits to a detached figure through a held
    reference still reach the Plots pane via `_redraw_stale_detached_figures`.

    Parameters
    ----------
    library_kinds
        Only detach figures created by these plotting libraries. Detach all if None.
    """
    from matplotlib._pylab_helpers import Gcf

    for manager in list(Gcf.get_all_fig_managers()):
        if not isinstance(manager, FigureManagerPositron):
            continue
        if library_kinds is not None and manager.plotting_library not in library_kinds:
            continue
        # Removes the manager from the registry and invokes our no-op `destroy`.
        # Pass the manager rather than its number: numbers freed here can be reused
        # by matplotlib, so destroying by number could hit a different figure.
        Gcf.destroy(manager)
        if manager._plot is not None:  # noqa: SLF001
            _detached_managers.add(manager)


def _detach_library_figures() -> None:
    """
    Detach high-level library figures (e.g. seaborn) after each interactive cell.

    Avoids duplicated elements such as stacked colorbars when re-running a cell.
    See https://github.com/posit-dev/positron/issues/8898.

    Plain matplotlib figures are intentionally left in the registry to preserve Positron's
    cross-cell figure persistence (updating or re-showing a plot across cells).
    """
    try:
        _detach_figures(library_kinds=_DETACH_AFTER_CELL_KINDS)
    except Exception:
        logger.exception("Error detaching high-level library figures")


# A whole-file run in a cell after IPython transforms it: Positron's Run Python File sends
# `%run -- <path>`, and users can type `%run` in the console. Matching the transformed cell
# finds `%run` on any line, but not in a string or a cell magic's body.
_RUN_FILE_RE = re.compile(r"\bget_ipython\(\)\.run_line_magic\('run',")

# The URI of the editor that the last file-attributed cell or whole-file run came from.
# None until code is run from a file, or after a `%run` typed in the console. Other
# console cells (which have no code location) don't change it.
_last_source_uri: str | None = None


def _current_source_uri() -> str | None:
    """The URI of the editor that the current execute_request came from, if any."""
    code_location = current_execute_request().code_location
    return code_location.uri if code_location is not None else None


def _is_file_run(raw_cell: str) -> bool:
    """
    Whether a cell runs a whole file with `%run`.

    Uses a fresh `TransformerManager` with only IPython's built-in transforms, rather than
    `shell.transform_cell`, so that the user's own input transformers (which may be
    stateful) don't run a second time for the cell. Skips the transform for cells that
    can't contain `%run`.
    """
    if "run" not in raw_cell:
        return False

    from IPython.core.inputtransformer2 import TransformerManager

    return _RUN_FILE_RE.search(TransformerManager().transform_cell(raw_cell)) is not None


def _detach_figures_on_source_change(info: ExecutionInfo) -> None:
    """
    Detach all figures before a cell that starts a new program.

    A cell starts a new program when it comes from a different file than the last
    file-attributed cell, or when it runs a whole file. Without this, a script's
    `plt.plot` draws onto the figure left over from another script.
    See https://github.com/posit-dev/positron/issues/7591.

    Console cells other than a `%run` never detach, so plotting from a script and then
    adjusting the figure in the console keeps working.
    """
    global _last_source_uri
    try:
        raw_cell = cast("str", info.raw_cell) or ""
        source_uri = _current_source_uri()
        is_file_run = _is_file_run(raw_cell)
        if is_file_run or (source_uri is not None and source_uri != _last_source_uri):
            _detach_figures()
        if is_file_run or source_uri is not None:
            _last_source_uri = source_uri
    except Exception:
        logger.exception("Error detaching figures on source change")


# Positron figure managers with a plot that `_detach_figures` removed from the registry.
# Figures the user closed with `plt.close` aren't tracked, so they're never redrawn. Weak
# so that tracking a manager doesn't keep its figure alive.
_detached_managers: weakref.WeakSet[FigureManagerPositron] = weakref.WeakSet()


def _redraw_stale_detached_figures() -> None:
    """
    Redraw detached figures that changed during the cell, updating their plots.

    matplotlib's own post-execute redraw (in interactive mode) only walks its registry,
    so a figure edited through a held reference after being detached (by
    `_detach_library_figures` or `_detach_figures_on_source_change`) would otherwise go
    stale in the Plots pane. Uses matplotlib's own `stale` flag, so an unchanged figure
    costs one attribute check. Drawing sends an update event only if the canvas changed.
    """
    try:
        from matplotlib._pylab_helpers import Gcf

        if not matplotlib.is_interactive():
            return

        registered = set(Gcf.get_all_fig_managers())
        for manager in list(_detached_managers):
            # Figures still in the registry are matplotlib's to redraw. A plot the user
            # removed from history must not be reopened by drawing its figure.
            if manager in registered or manager.closed:
                continue
            if manager.canvas.figure.stale:
                manager.canvas.draw()
    except Exception:
        logger.exception("Error redrawing detached figures")


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

    canvas: FigureCanvasPositron  # type: ignore

    def __init__(self, canvas: FigureCanvasPositron, num: int | str):
        from ..positron_ipkernel import PositronIPyKernel

        super().__init__(canvas, num)

        kernel = cast("PositronIPyKernel", PositronIPyKernel.instance())

        # Detect which plotting library was used. Stored so `detach_library_figures`
        # can decide whether this figure should be detached after each cell.
        kind = _detect_plotting_library()
        self.plotting_library = kind

        # Create the plot instance via the plots service.
        self._plots_service = kernel.plots_service
        self._plot: Plot | None = None
        if kind not in _NO_PLOT_KINDS:
            self._plot = self._plots_service.create_plot(
                canvas.render, canvas.intrinsic_size, kind, num, self._on_close
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
        return self._plot is not None and self._plot.closed

    def show(self) -> None:
        """Called by matplotlib when a figure is shown via `plt.show()` or `figure.show()`."""
        if self._plot is not None:
            self._plot.show()

    @classmethod
    def pyplot_show(cls, *, block: bool | None = None) -> None:  # noqa: ARG003
        """
        Called by matplotlib when a user calls `plt.show()`.

        Matplotlib's default shows every open figure. Positron keeps plain figures open
        across cells, so the N-th `plt.show()` would re-render and re-select all N earlier
        figures in the Plots pane. Every figure is already in the Plots pane from when it was
        created, so instead show only the active figure, so that `plt.figure(n); plt.show()`
        still selects figure n. Other figures that were edited are drawn, which sends an
        `update` (the frontend selects an updated plot too).

        `block` is accepted for API compatibility and ignored: there's no GUI main loop.
        """
        from matplotlib._pylab_helpers import Gcf
        from matplotlib.backend_bases import NonGuiException

        active = Gcf.get_active()
        for manager in Gcf.get_all_fig_managers():
            if manager is active or not isinstance(manager, FigureManagerPositron):
                # A figure from a non-GUI backend (e.g. Agg) can outlive a switch to this
                # backend. Warn like matplotlib's default `pyplot_show` instead of raising.
                # Attribute the warning to the caller of `plt.show()`: the kernel sends
                # warnings from Positron files to the log instead of the console.
                try:
                    manager.show()
                except NonGuiException as exc:
                    warnings.warn(str(exc), stacklevel=3)
            elif manager.canvas.figure.stale:
                # Nothing has redrawn an edited figure yet: interactive mode only redraws after
                # the cell finishes, and `plt.ioff()` never does.
                manager.canvas.draw_idle()

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
        if self._plot is not None:
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

    manager: FigureManagerPositron  # type: ignore

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
            if not self._first_render_completed or is_rendering:
                pass
            # If the plot was closed after being opened, request an update to re-open the plot.
            elif self.manager.closed:
                self.manager.update()
            else:
                # Check if the canvas contents have changed, and request an update if they have.
                current_hash = self._hash_buffer_rgba()
                logger.debug(f"Canvas: previous hash: {self._previous_hash[:6]}")
                logger.debug(f"Canvas: current hash: {current_hash[:6]}")
                if current_hash == self._previous_hash:
                    logger.debug("Canvas: hash is the same, no need to update")
                else:
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


# The original and installed `plt.gca`, so `uninstall` can undo our changes.
_original_gca = None
_installed_gca = None


def _install_library_gca_redirect() -> None:
    """
    Redirect a high-level library's implicit `plt.gca()` to a fresh figure.

    Make a high-level library (e.g. seaborn) draw on a fresh figure instead of an existing
    one created by a different library.

    Seaborn's axes-level functions draw on `plt.gca()` when no `ax=` is given. With a
    persistent figure registry, that current figure may be a leftover from a different
    library (for example a matplotlib plot from an earlier cell), so seaborn would draw
    over it. We intercept `plt.gca()`: when a library on the call stack differs from the
    library that created the active figure, return the axes of a fresh figure instead.

    This only affects the implicit `plt.gca()` path -- an explicit `ax=` is untouched --
    and only fires across libraries, so plain matplotlib figures remain reusable
    (preserving cross-cell persistence). See https://github.com/posit-dev/positron/issues/8898.
    """
    global _original_gca, _installed_gca
    if _installed_gca is not None:
        return

    import matplotlib.pyplot as plt
    from matplotlib._pylab_helpers import Gcf

    _original_gca = plt.gca

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
        assert _original_gca is not None
        return _original_gca(*args, **kwargs)

    plt.gca = _installed_gca = gca


def _uninstall_library_gca_redirect() -> None:
    """Restore the original `plt.gca`, undoing `_install_library_gca_redirect`."""
    global _original_gca, _installed_gca
    if _installed_gca is None:
        return

    import matplotlib.pyplot as plt

    # Only restore if our redirect is still the installed `gca`; something else may have
    # patched over it, in which case we leave that patch alone.
    if plt.gca is _installed_gca:
        plt.gca = _original_gca

    _original_gca = None
    _installed_gca = None


# Fulfill the matplotlib backend API.
FigureCanvas = FigureCanvasPositron
FigureManager = FigureManagerPositron


def _after_cell() -> None:
    """Detach library figures, then push edits to detached figures to the Plots pane."""
    _detach_library_figures()
    _redraw_stale_detached_figures()


def install(shell: InteractiveShell) -> None:
    """Install the console backend's shell hooks. See `BackendModule`."""
    global _last_source_uri

    # This usually runs partway through the cell that first makes a figure, after that
    # cell's pre-run hooks fired, so remember that cell's file here instead.
    _last_source_uri = _current_source_uri()
    shell.events.register("pre_run_cell", _detach_figures_on_source_change)
    shell.events.register("post_execute", _after_cell)

    _install_library_gca_redirect()


def uninstall(shell: InteractiveShell) -> None:
    """Remove the console backend's shell hooks. See `BackendModule`."""
    # Suppress ValueError in case user code unregistered a hook itself; a backend
    # switch shouldn't crash over it.
    with contextlib.suppress(ValueError):
        shell.events.unregister("pre_run_cell", _detach_figures_on_source_change)
    with contextlib.suppress(ValueError):
        shell.events.unregister("post_execute", _after_cell)

    _uninstall_library_gca_redirect()


# If we are the selected backend, activate through the registry, which also tears
# down the other backend if it was active. This runs when matplotlib imports the
# module to switch to it. See the note at the top of the file. `Backend.from_name`
# matches both spellings, which matters here: matplotlib can still report our short
# name via `get_backend()` at this point, before it settles into the `module://`
# spelling.
if Backend.from_name(matplotlib.get_backend()) is Backend.CONSOLE:
    registry.activate(Backend.CONSOLE)
