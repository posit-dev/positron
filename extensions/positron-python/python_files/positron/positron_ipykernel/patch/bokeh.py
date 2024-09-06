#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import logging

from ..session_mode import SessionMode

logger = logging.getLogger(__name__)


def _positron_no_access(filename: str):
    return True


# never allow bokeh to write files in the positron-python extension
# see https://github.com/posit-dev/positron/issues/4397
def patch_bokeh_no_access():
    try:
        from bokeh.io import util

        util._no_access = _positron_no_access
    except ImportError:
        pass


MIME_TYPE_POSITRON_WEBVIEW_FLAG = "application/positron-webview-load.v0+json"


def handle_bokeh_output(session_mode: SessionMode) -> None:
    """
    Override the bokeh notebook display function to add a flag that the front-end can pick up on to
    know that the data coming over should be replayed in multiple steps.

    Args:
        session_mode: The mode that the kernel application was started in.
        logger: A logger function.
    """
    if session_mode == SessionMode.NOTEBOOK:
        # Don't do anything if we're in a notebook
        return

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
