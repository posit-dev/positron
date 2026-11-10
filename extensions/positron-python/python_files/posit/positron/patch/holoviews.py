#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import base64
import logging

from ..session_mode import SessionMode
from ..ui import UiService

logger = logging.getLogger(__name__)


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


def _patch_static_image_components() -> None:
    """
    Display static HoloViews plots (e.g. the matplotlib backend) as images in the console.

    HoloViews renders static plots as an HTML `<img>` fragment, which the console shows inline
    instead of in the Plots pane. Emit an image MIME bundle instead so that the plot is shown in the
    Plots pane like any other static plot.
    """
    try:
        from holoviews.plotting import Plot, Renderer
        from holoviews.plotting.renderer import MIME_TYPES
        from panel.viewable import Viewable

        original_components = Renderer.components

        def patched_components(self, obj, fmt=None, comm=True, **kwargs):  # noqa: FBT002
            if isinstance(obj, Plot):
                plot = obj
            else:
                plot, fmt = self._validate(obj, fmt)

            mime_type = MIME_TYPES.get(fmt) if fmt else None
            if isinstance(plot, Viewable) or mime_type not in ("image/png", "image/svg+xml"):
                return original_components(self, plot, fmt, comm, **kwargs)

            data = self._figure_data(plot, fmt, **kwargs)
            if isinstance(data, bytes):
                data = base64.b64encode(data).decode("ascii")
            return {mime_type: data}, {}

        Renderer.components = patched_components
    except Exception as e:
        # If patching fails, static plots are still shown, just inline in the console
        logger.warning("Could not patch holoviews to show static plots in the Plots pane: %s", e)
