#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from ..ui import UiService


def set_holoviews_extension(ui_service: UiService) -> None:
    """
    Patch holoviews to use a custom notebook extension.

    This function attempts to import holoviews and, if successful,
    replaces the default notebook extension with a custom one that
    notifies the frontend of new extension loads.

    Args:
        ui_service (UiService): The UI service to use for notifications.
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
            import sys

            print(
                f"Warning: Could not patch hvplot for block execution due to an error: {e}. "
                "Run each line separately if plots don't appear.",
                file=sys.stderr,
            )
