#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import logging

from ..kernel.session_mode import SessionMode

logger = logging.getLogger(__name__)


def _positron_no_access(_filename: str):
    return True


# never allow bokeh to write files in the positron-python extension
# see https://github.com/posit-dev/positron/issues/4397
def patch_bokeh_no_access():
    try:
        from bokeh.io import util

        util._no_access = _positron_no_access  # noqa: SLF001
    except ImportError:
        pass


MIME_TYPE_POSITRON_WEBVIEW_FLAG = "application/positron-webview-load.v0+json"


def handle_bokeh_output(session_mode: SessionMode) -> None:
    """
    Make various patches to improve the experience of using bokeh plots in console sessions.

    Args:
        session_mode: The mode that the kernel application was started in.
    """
    if session_mode == SessionMode.NOTEBOOK:
        # Don't do anything if we're in a notebook
        return

    hide_glyph_renderer_output()
    add_preload_mime_type()


def add_preload_mime_type():
    """
    Override bokeh.io.notebook.publish_display_data.

    Override the bokeh notebook display function to add a flag that the front-end can pick up on to
    know that the data coming over should be replayed in multiple steps.
    """
    try:
        from bokeh.io import notebook

    except ImportError:
        return

    old_publish_display_data = getattr(notebook, "publish_display_data", None)

    if old_publish_display_data is None:
        logger.warning(
            "Could not find bokeh.io.notebook.publish_display_data to update. Bokeh plots may not display correctly."
        )
        return

    def new_publish_display_data(*args, **kwargs) -> None:
        if isinstance(args[0], dict):
            # Take the first arg, which is a dictionary and add a new key that will let the
            # frontend know that this data comes from bokeh in notebook mode.
            args[0][MIME_TYPE_POSITRON_WEBVIEW_FLAG] = ""
        old_publish_display_data(*args, **kwargs)

    logger.debug("Overrode bokeh.notebook.publish_display_data")
    notebook.publish_display_data = new_publish_display_data


def hide_glyph_renderer_output():
    """
    Disable the `_repr_html_` method on the Model class.

    This is to prevent it from being called when the
    model is displayed and thus confusing positron into thinking it's a plot to show.
    """
    try:
        from bokeh.models import Model

        del Model._repr_html_  # type: ignore

    except (ImportError, AttributeError):
        return
