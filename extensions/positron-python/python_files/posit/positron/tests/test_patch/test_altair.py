#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import webbrowser
from pathlib import Path

import altair as alt
import pytest

from positron.patch.altair import RENDERER_NAME, patch_altair_renderer
from positron.session_mode import SessionMode


@pytest.fixture(autouse=True)
def _restore_renderer():
    active = alt.renderers.active
    yield
    alt.renderers.enable(active)


@pytest.fixture
def opened_urls(monkeypatch):
    urls = []
    monkeypatch.setattr(webbrowser, "open", lambda url: urls.append(url) or True)
    return urls


def test_chart_is_written_to_html_file(opened_urls):
    alt.renderers.enable("default")
    patch_altair_renderer(SessionMode.CONSOLE)

    chart = alt.Chart(alt.Data(values=[{"x": 1}, {"x": 2}])).mark_point().encode(x="x:Q")
    bundle = chart._repr_mimebundle_()

    assert len(opened_urls) == 1
    path = Path(opened_urls[0].removeprefix("file://"))
    html = path.read_text(encoding="utf-8")
    assert {
        "renderer": alt.renderers.active,
        "bundle": bundle,
        "name": path.name.startswith("positron_altair_") and path.suffix == ".html",
        "embeds": "vegaEmbed(" in html and f"vega-lite@{alt.VEGALITE_VERSION}" in html,
    } == {"renderer": RENDERER_NAME, "bundle": {}, "name": True, "embeds": True}


def test_user_renderer_is_kept():
    alt.renderers.enable("mimetype")
    patch_altair_renderer(SessionMode.CONSOLE)

    assert alt.renderers.active == "mimetype"


def test_not_patched_in_notebook_mode():
    alt.renderers.enable("default")
    patch_altair_renderer(SessionMode.NOTEBOOK)

    assert alt.renderers.active == "default"
