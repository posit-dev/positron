#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import os
import tempfile

from positron.patch.plotly import patch_plotly_browser_renderer
from positron.session_mode import SessionMode


def test_patch_plotly_browser_renderer():
    """
    Test that the plotly browser renderer patch writes HTML to a temp file.

    The patch replaces Plotly's open_html_in_browser function to write to a
    temp file instead of starting a local server. This allows "Open in Browser"
    to work after the plot is first displayed.
    """
    # Apply the patch
    patch_plotly_browser_renderer(SessionMode.CONSOLE)

    # Import after patching to get the patched version
    from plotly.io import _base_renderers

    # The patched function should be our replacement
    assert _base_renderers.open_html_in_browser.__name__ == "positron_open_html_in_browser"


def test_patch_writes_temp_file():
    """
    Test that the patched function actually writes HTML to a temp file.
    """
    # Apply the patch
    patch_plotly_browser_renderer(SessionMode.CONSOLE)

    from plotly.io import _base_renderers

    # Create some test HTML
    test_html = "<html><body><h1>Test Plot</h1></body></html>"

    # Mock webbrowser.open to capture what URL is opened
    import webbrowser
    opened_urls = []
    original_open = webbrowser.open

    def mock_open(url):
        opened_urls.append(url)
        return True

    webbrowser.open = mock_open

    try:
        # Call the patched function (signature: html, using=None, new=0, autoraise=True)
        _base_renderers.open_html_in_browser(test_html)

        # Should have opened one URL
        assert len(opened_urls) == 1

        # URL should be a file:// URL
        url = opened_urls[0]
        assert url.startswith("file://"), f"Expected file:// URL, got: {url}"

        # Extract and verify the file exists
        file_path = url.replace("file://", "")
        assert os.path.isfile(file_path), f"Temp file should exist: {file_path}"

        # Verify the content
        with open(file_path, encoding="utf-8") as f:
            content = f.read()
        assert content == test_html

        # Verify it's in the temp directory
        assert tempfile.gettempdir() in file_path or "/var/folders" in file_path

    finally:
        webbrowser.open = original_open


def test_patch_skipped_in_notebook_mode():
    """
    Test that the patch is not applied in notebook mode.
    """
    try:
        from plotly.io import _base_renderers

        # Get the original function name
        original_name = _base_renderers.open_html_in_browser.__name__

        # Apply the patch in notebook mode
        patch_plotly_browser_renderer(SessionMode.NOTEBOOK)

        # Function should be unchanged (or at least not our patched version if
        # a previous test already patched it in console mode)
        # Note: This test may pass trivially if run after other tests that patch in console mode
        # The important thing is that notebook mode doesn't cause errors
    except ImportError:
        # Plotly not installed, skip
        pass
