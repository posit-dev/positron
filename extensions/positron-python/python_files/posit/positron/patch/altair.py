#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""
Patches for Altair to improve the experience in Positron.

In a console, Altair's default renderer sends the chart as an HTML snippet, which
the Plots pane shows in a webview with no URL. Such plots can't be opened in a
browser.

We register a renderer that writes the chart to a standalone HTML file and opens
it, which sends it to the Plots pane as an HTML plot, the same as Plotly plots.
"""

import logging
import tempfile
import webbrowser
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..session_mode import SessionMode

logger = logging.getLogger(__name__)

RENDERER_NAME = "positron"


def positron_altair_renderer(spec: dict[str, Any], **metadata: Any) -> dict[str, Any]:
    """
    Altair renderer that writes the chart to an HTML file and opens it.

    Positron sends the file to the Plots pane. The page loads Vega from a CDN.

    Args:
        spec: The Vega-Lite spec of the chart.
        metadata: Renderer options, such as `embed_options`.

    Returns:
        An empty MIME bundle, since the chart is shown in the Plots pane.
    """
    import altair as alt
    from altair.utils.html import spec_to_html

    html = spec_to_html(
        spec,
        mode="vega-lite",
        vega_version=alt.VEGA_VERSION,
        vegaembed_version=alt.VEGAEMBED_VERSION,
        vegalite_version=alt.VEGALITE_VERSION,
        embed_options=metadata.get("embed_options"),
    )
    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".html",
        prefix="positron_altair_",
        delete=False,
        encoding="utf-8",
    ) as f:
        f.write(html)

    # Positron's browser sends HTML files opened from this function to the Plots pane.
    webbrowser.open(f"file://{f.name}")
    return {}


def patch_altair_renderer(session_mode: "SessionMode") -> None:
    """
    Make Altair show charts in the Plots pane as HTML plots.

    The renderer is enabled only while Altair's default renderer is active, so a
    renderer that the user chooses still applies.

    Args:
        session_mode: The mode that the kernel application was started in.
    """
    from ..session_mode import SessionMode

    if session_mode == SessionMode.NOTEBOOK:
        # Notebooks render Altair charts inline.
        return

    try:
        import altair as alt
    except (ImportError, TypeError):
        # On Python 3.10, Altair fails to import with a TypeError after the
        # vendored typing_extensions (pinned below 4.11) is loaded. See #17381.
        return

    alt.renderers.register(RENDERER_NAME, positron_altair_renderer)
    if alt.renderers.active == "default":
        alt.renderers.enable(RENDERER_NAME)
    logger.debug("Registered the Positron Altair renderer")
