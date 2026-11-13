#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import io
import itertools
import logging
from typing import TYPE_CHECKING, cast

from ..session_mode import SessionMode

if TYPE_CHECKING:
    from holoviews.core.dimension import Dimensioned
    from matplotlib.figure import Figure

    from ..plot_comm import PlotSize
    from ..positron_ipkernel import PositronIPyKernel
    from ..ui import UiService

logger = logging.getLogger(__name__)

# Numbers used to name HoloViews plots in the Plots pane.
_plot_numbers = itertools.count(1)


def set_holoviews_extension(ui_service: UiService, session_mode: SessionMode) -> None:
    """
    Patch holoviews to use a custom notebook extension.

    This function attempts to import holoviews and, if successful,
    replaces the default notebook extension with a custom one that
    notifies the frontend of new extension loads.

    Args:
        ui_service (UiService): The UI service to use for notifications.
        session_mode (SessionMode): The mode that the kernel application was started in.
    """
    try:
        import holoviews
    except ImportError:
        pass
    else:
        if holoviews.extension == holoviews.ipython.notebook_extension:

            class PositronNotebookExtension(holoviews.ipython.notebook_extension):
                """
                Custom notebook extension for HoloViews.

                Notifies the frontend of new extension loads.
                """

                def __call__(self, *args, **kwargs) -> None:
                    # Notify the frontend that a new holoviews extension has been loaded, so
                    # that it can clear stored messages for the session.
                    ui_service.clear_webview_preloads()

                    if session_mode != SessionMode.NOTEBOOK and (
                        "matplotlib" in args or "matplotlib" in kwargs
                    ):
                        _allow_positron_matplotlib_backend()

                    super().__call__(*args, **kwargs)

            holoviews.extension = PositronNotebookExtension

        # Fix hvplot block execution issue in Positron console
        #
        # Issue: When hvplot code is executed as a block (multiple lines at once) in Positron's
        # console, plots fail to render. This happens because:
        #
        # 1. HoloViews tracks execution context using a `_repeat_execution_in_cell` flag
        # 2. When multiple displays occur in the same execution (like when running a block),
        #    this flag becomes True
        # 3. HoloViews passes this flag as `reloading=True` to Panel's load_notebook() function
        # 4. Panel then generates JavaScript with `force=false`, skipping essential dependencies
        #    like Bokeh, Panel itself, and plotting libraries
        # 5. Positron creates fresh webviews for each plot (unlike notebooks which have persistent
        #    webviews), so these missing dependencies cause plots to fail
        #
        # The fix: Force `reloading=False` to ensure Panel always loads all dependencies.
        # This is required because Positron's fresh webviews always need the full dependency set.
        try:
            from holoviews.plotting import Renderer

            original_load_nb = Renderer.load_nb

            @classmethod
            def patched_load_nb(cls, *args, **kwargs):  # noqa: ARG001
                # Simply override reloading if present, pass everything else through
                if "reloading" in kwargs:
                    kwargs["reloading"] = False
                return original_load_nb(*args, **kwargs)

            Renderer.load_nb = patched_load_nb
        except Exception as e:
            # If patching fails, hvplot still works, just without our fix
            logger.warning(
                "Could not patch hvplot for block execution due to an error: %s. "
                "Run each line separately if plots don't appear.",
                e,
            )

        if session_mode != SessionMode.NOTEBOOK:
            _patch_static_image_components()


def _allow_positron_matplotlib_backend() -> None:
    """
    Keep Positron's matplotlib backend when HoloViews loads its matplotlib extension.

    HoloViews switches matplotlib to the non-interactive `agg` backend unless the current backend
    is in its allowlist, which would stop later matplotlib plots from reaching the Plots pane.
    Positron's backend doesn't open plots for HoloViews' own figures (see `console.py`).
    """
    try:
        from holoviews.plotting.mpl import renderer
    except ImportError:
        # matplotlib is an optional HoloViews dependency
        return

    from ..matplotlib_backend.backend import Backend

    for name in (Backend.CONSOLE.short_name, Backend.CONSOLE.full_name):
        if name not in renderer._MPL_BACKENDS_ALLOWLIST:  # noqa: SLF001
            renderer._MPL_BACKENDS_ALLOWLIST.append(name)  # noqa: SLF001


def _patch_static_image_components() -> None:
    """
    Show static HoloViews matplotlib plots in the Plots pane.

    HoloViews renders static matplotlib plots as an HTML `<img>` fragment, which the console shows
    inline. Instead, open the figure in the Plots pane via the plots service and display nothing in
    the console (see `display_holoviews`), like plots from Positron's matplotlib backend.
    """
    try:
        from holoviews.plotting import Plot, Renderer

        original_components = Renderer.components

        def patched_components(self, obj, fmt=None, comm=True, **kwargs):  # noqa: FBT002
            if self.backend != "matplotlib":
                return original_components(self, obj, fmt, comm, **kwargs)

            if isinstance(obj, Plot):
                plot = obj
            else:
                plot, fmt = self._validate(obj, fmt)

            if not isinstance(plot, Plot) or fmt not in ("png", "svg"):
                return original_components(self, plot, fmt, comm, **kwargs)

            _show_in_plots_pane(plot.state)
            return {}, {}

        Renderer.components = patched_components
    except Exception as e:
        # If patching fails, static plots are still shown, just inline in the console
        logger.warning("Could not patch holoviews to show static plots in the Plots pane: %s", e)


def display_holoviews(obj: Dimensioned) -> None:
    """
    Display a HoloViews object.

    Unlike IPython's default display, don't fall back to the object's text repr when HoloViews
    displays nothing in the console, e.g. when the plot is shown in the Plots pane instead.
    """
    from holoviews import Store
    from IPython.display import publish_display_data

    data, metadata = obj._repr_mimebundle_()
    # Show nothing if HoloViews displayed nothing, unless no HoloViews extension is loaded.
    # `hv.extension` registers the display hooks; importing a renderer alone (e.g. via `hv.save`)
    # does not.
    if data or not Store._display_hooks:  # noqa: SLF001
        # Include the text repr like IPython would. The frontend also requires it to recognize
        # interactive HoloViews plots.
        publish_display_data({"text/plain": repr(obj), **data}, metadata)


def _show_in_plots_pane(figure: Figure) -> None:
    """Open a matplotlib figure in the Plots pane."""
    from ..positron_ipkernel import PositronIPyKernel

    intrinsic_size = tuple(figure.get_size_inches())

    def render(size: PlotSize | None, pixel_ratio: float, format_: str) -> bytes:
        if size is None:
            figure.set_size_inches(*intrinsic_size, forward=False)
        else:
            figure.set_size_inches(size.width / figure.dpi, size.height / figure.dpi, forward=False)
        with io.BytesIO() as buffer:
            figure.savefig(
                buffer,
                format=format_,
                dpi=figure.dpi * pixel_ratio,
                bbox_inches="tight" if size is None else None,
            )
            return buffer.getvalue()

    kernel = cast("PositronIPyKernel", PositronIPyKernel.instance())
    kernel.plots_service.create_plot(render, intrinsic_size, "HoloViews", next(_plot_numbers))
