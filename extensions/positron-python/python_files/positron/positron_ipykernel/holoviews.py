#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from .ui import UiService


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

            class positron_notebook_extension(holoviews.ipython.notebook_extension):
                def __call__(self, *args, **kwargs) -> None:
                    """
                    Custom notebook extension for HoloViews that notifies the frontend
                    of new extension loads.
                    """
                    # Notify the frontend that a new holoviews extension has been loaded, so
                    # that it can clear stored messages for the session.
                    ui_service.holoviz_extension_load()

                    super().__call__(*args, **kwargs)

            holoviews.extension = positron_notebook_extension
