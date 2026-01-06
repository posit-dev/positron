#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""
Patches for Plotly to improve the experience in Positron.

The main issue is that Plotly's browser renderer uses a single-use local server
that shuts down immediately after serving content. This causes problems with
Positron's "Open in Browser" feature because the server is gone by the time the
user clicks the button.

We patch the renderer to write HTML to a temp file instead of starting a server,
which allows the content to be reopened at any time.
"""

import logging
import tempfile
import webbrowser
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..session_mode import SessionMode

logger = logging.getLogger(__name__)


def patch_plotly_browser_renderer(session_mode: "SessionMode") -> None:
    """
    Patch Plotly's browser renderer to write HTML to a temp file.

    This replaces the default behavior of starting a local server with writing
    to a temp file, which solves the "Open in Browser" issue where the server
    is gone by the time the user wants to reopen the plot.

    Args:
        session_mode: The mode that the kernel application was started in.
    """
    from ..session_mode import SessionMode

    if session_mode == SessionMode.NOTEBOOK:
        # Don't patch in notebook mode - notebooks handle plots differently
        return

    try:
        from plotly.io import _base_renderers
    except ImportError:
        # Plotly not installed
        return

    # Check if the function we need to patch exists
    if not hasattr(_base_renderers, "open_html_in_browser"):
        logger.warning(
            "Could not find plotly.io._base_renderers.open_html_in_browser to patch. "
            "Plotly plots may not work correctly with 'Open in Browser'."
        )
        return

    def positron_open_html_in_browser(html: str, using=None, new=0, autoraise=True) -> None:  # noqa: ARG001, FBT002
        """
        Replacement for Plotly's open_html_in_browser that writes to a temp file.

        Instead of starting a single-use server, we write the HTML to a temp file
        and open that. This allows the plot to be reopened later via "Open in Browser".

        Args:
            html: The HTML string to display.
            using: Which browser to use (passed to webbrowser, but we ignore it).
            new: Browser window behavior (passed to webbrowser, but we ignore it).
            autoraise: Whether to raise the browser window (passed to webbrowser, but we ignore it).
        """
        # Write HTML to a temp file
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".html",
            prefix="positron_plotly_",
            delete=False,
            encoding="utf-8",
        ) as f:
            f.write(html)
            temp_path = f.name

        # Open the temp file in the browser (which Positron will intercept)
        webbrowser.open(f"file://{temp_path}")

    # Replace the function
    _base_renderers.open_html_in_browser = positron_open_html_in_browser
    logger.debug("Patched plotly.io._base_renderers.open_html_in_browser")
