#
# Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict

import numpy as np
import pandas as pd
import polars as pl
import pytest

from positron.plot_comm import PlotRenderFormat
from positron.positron_ipkernel import PositronIPyKernel, PositronShell
from positron.ui import UiService
from positron.ui_comm import ShowHtmlFileDestination, UiFrontendEvent
from positron.utils import alias_home

from .conftest import DummyComm
from .utils import (
    comm_open_message,
    json_rpc_notification,
    json_rpc_request,
    json_rpc_response,
    preserve_working_directory,
)

try:
    import torch
except ImportError:
    torch = None

TARGET_NAME = "target_name"


@pytest.fixture
def ui_service(kernel: PositronIPyKernel) -> UiService:
    """The Positron UI service."""
    return kernel.ui_service


@pytest.fixture
def ui_comm(ui_service: UiService) -> DummyComm:
    """Open a dummy comm for the UI service."""
    # TODO: Close any existing comms?

    # Open a comm
    ui_comm = DummyComm(TARGET_NAME)
    ui_service.on_comm_open(ui_comm, {})

    # Clear messages due to the comm_open
    ui_comm.messages.clear()

    return ui_comm


def working_directory_event() -> Dict[str, Any]:
    return json_rpc_notification("working_directory", {"directory": str(alias_home(Path.cwd()))})


def show_url_event(url: str) -> Dict[str, Any]:
    return json_rpc_notification(UiFrontendEvent.ShowUrl, {"url": url, "source": None})


def show_html_file_event(path: str, *, destination: str) -> Dict[str, Any]:
    return json_rpc_notification(
        "show_html_file", {"path": path, "destination": destination, "height": 0, "title": ""}
    )


def test_comm_open(ui_service: UiService) -> None:
    # Double-check that comm is not yet open
    assert ui_service._comm is None  # noqa: SLF001

    # Open a comm
    ui_comm = DummyComm(TARGET_NAME)
    ui_service.on_comm_open(ui_comm, {})

    # Check that the comm_open and initial working_directory messages are sent
    assert ui_comm.messages == [comm_open_message(TARGET_NAME), working_directory_event()]


def test_set_console_width(ui_comm: DummyComm) -> None:
    """Test the `setConsoleWidth` RPC method called from Positron."""
    width = 118
    msg = json_rpc_request(
        "call_method",
        {
            "method": "setConsoleWidth",
            "params": [width],
        },
        comm_id="dummy_comm_id",
    )
    ui_comm.handle_msg(msg)

    # Check that the response is sent, with a result of None.
    assert ui_comm.messages == [json_rpc_response(None)]

    # See the comments in positron.ui._set_console_width for a description of these values.
    assert os.environ["COLUMNS"] == str(width)
    assert np.get_printoptions()["linewidth"] == width
    assert pd.get_option("display.width") is None
    assert pl.Config.state()["POLARS_TABLE_WIDTH"] == str(width)
    if torch is not None:
        assert torch._tensor_str.PRINT_OPTS.linewidth == width  # type: ignore[reportGeneralTypeIssues]  # noqa: SLF001


def test_open_editor(ui_service: UiService, ui_comm: DummyComm) -> None:
    file, line, column = "/Users/foo/bar/baz.py", 12, 34
    ui_service.open_editor(file, line, column)

    assert ui_comm.messages == [
        json_rpc_notification(
            "open_editor",
            {"file": file, "line": line, "column": column, "kind": None, "pinned": True},
        )
    ]


def test_open_editor_preview(ui_service: UiService, ui_comm: DummyComm) -> None:
    file, line, column = "/Users/foo/bar/baz.py", 12, 34
    ui_service.open_editor(file, line, column, pinned=False)

    assert ui_comm.messages == [
        json_rpc_notification(
            "open_editor",
            {"file": file, "line": line, "column": column, "kind": None, "pinned": False},
        )
    ]


@pytest.mark.parametrize(
    ("binding_name", "binding_target", "expected_attached"),
    [
        # `import numpy` -- binds 'numpy' to the numpy module. This case
        # also stands in for `import numpy.linalg`, which binds the same
        # 'numpy' top-level (the submodule is reachable as an attribute).
        ("numpy", "numpy", True),
        # `import numpy as np` -- binds 'np' to the numpy module
        # (module's __name__ is still 'numpy').
        ("np", "numpy", True),
        # `from numpy import linalg` -- binds 'linalg' to the numpy.linalg
        # submodule. The submodule's __name__ is 'numpy.linalg', so the
        # detector's top-level extraction matches numpy.
        ("linalg", "numpy.linalg", True),
        # Defensive: a non-module value bound under the same name as a
        # distribution must not produce a false positive.
        ("numpy", "not-a-module", False),
    ],
    ids=["import-x", "import-x-as-y", "from-pkg-import-sub", "non-module-value"],
)
def test_get_packages_installed_attached(
    kernel: PositronIPyKernel,
    shell: PositronShell,
    binding_name: str,
    binding_target: str,
    expected_attached: bool,  # noqa: FBT001
) -> None:
    """Verify `attached` detection across the import patterns we document.

    Covers `import x`, `import x as y`, and `from pkg import sub` (when
    sub is a module), and asserts that a non-module value bound under a
    distribution name does not falsely trigger the indicator.
    """
    import importlib

    from positron.ui import _get_packages_installed

    if binding_target == "not-a-module":
        value: object = "not a module"
    else:
        value = importlib.import_module(binding_target)
    shell.user_ns[binding_name] = value

    result = _get_packages_installed(kernel, [])
    assert isinstance(result, list)
    numpy_entry = next(
        (pkg for pkg in result if isinstance(pkg, dict) and pkg.get("displayName") == "numpy"),
        None,
    )
    assert numpy_entry is not None, "numpy distribution should be present in the test environment"
    assert numpy_entry["attached"] is expected_attached


class _StubMetadata:
    """Minimal `Distribution.metadata` stand-in (only the accessors we use)."""

    def __init__(self, headers: Dict[str, Any]) -> None:
        self._headers = headers

    def get(self, key: str, default: Any = None) -> Any:
        value = self._headers.get(key, default)
        if isinstance(value, list):
            return value[0] if value else default
        return value

    def get_all(self, key: str) -> Any:
        value = self._headers.get(key)
        if value is None:
            return None
        return value if isinstance(value, list) else [value]


class _StubDist:
    def __init__(self, **headers: Any) -> None:
        self.metadata = _StubMetadata(headers)


@pytest.mark.parametrize(
    ("headers", "expected_url"),
    [
        # A Project-URL homepage is the top choice.
        ({"Project-URL": ["Homepage, https://home"]}, "https://home"),
        # The legacy singular Home-page header counts as a homepage.
        ({"Home-page": "https://legacy"}, "https://legacy"),
        # Repository wins as a fallback when there's no homepage.
        ({"Project-URL": ["Repository, https://repo"]}, "https://repo"),
        # Homepage outranks repository regardless of order.
        (
            {"Project-URL": ["Repository, https://repo", "Homepage, https://home"]},
            "https://home",
        ),
        # Free-form labels normalize ("Source Code" -> repository).
        ({"Project-URL": ["Source Code, https://src"]}, "https://src"),
        # A Project-URL homepage outranks the legacy Home-page header.
        (
            {"Project-URL": ["Homepage, https://home"], "Home-page": "https://legacy"},
            "https://home",
        ),
        # An unrecognized label still beats having no URL at all.
        ({"Project-URL": ["Funding, https://fund"]}, "https://fund"),
        # No URL metadata of any kind.
        ({}, None),
    ],
    ids=[
        "project-url-homepage",
        "legacy-home-page",
        "repository-only",
        "homepage-beats-repository",
        "normalized-label",
        "project-url-beats-legacy",
        "unrecognized-fallback",
        "none",
    ],
)
def test_best_package_url(headers: Dict[str, Any], expected_url: Any) -> None:
    """Rank homepage > repository > docs > other.

    The legacy `Home-page` header acts as a homepage fallback.
    """
    from positron.ui import _best_package_url

    assert _best_package_url(_StubDist(**headers)) == expected_url  # type: ignore[arg-type]


def test_is_module_loaded(ui_comm: DummyComm) -> None:
    """Test the `isModuleLoaded` RPC method called from Positron."""
    module = "fallingStars"
    msg = json_rpc_request(
        "call_method",
        {
            "method": "isModuleLoaded",
            "params": [module],
        },
        comm_id="dummy_comm_id",
    )
    ui_comm.handle_msg(msg)

    # Check that the response is sent, with a result of False.
    assert ui_comm.messages == [json_rpc_response(result=False)]


def test_did_change_plots_render_settings(kernel: PositronIPyKernel, ui_comm: DummyComm) -> None:
    msg = json_rpc_request(
        "did_change_plots_render_settings",
        {"settings": {"size": {"width": 800, "height": 600}, "pixel_ratio": 2.0, "format": "png"}},
        comm_id="dummy_comm_id",
    )
    ui_comm.handle_msg(msg)

    settings = kernel.plots_service.get_render_settings()
    assert settings is not None
    assert settings.size.width == 800
    assert settings.size.height == 600
    assert settings.pixel_ratio == 2.0
    assert settings.format == PlotRenderFormat.Png


def test_clear_console(ui_service: UiService, ui_comm: DummyComm) -> None:
    ui_service.clear_console()

    assert ui_comm.messages == [json_rpc_notification("clear_console", {})]


def test_poll_working_directory(shell: PositronShell, ui_comm: DummyComm) -> None:
    # If a cell execution does not change the working directory, no comm messages should be sent.
    shell.run_cell("print()")

    assert ui_comm.messages == []

    # If the working directory *does* change, a working directory event should be sent.
    with preserve_working_directory():
        shell.run_cell(
            """import os
os.chdir('..')"""
        )

        assert ui_comm.messages == [working_directory_event()]


def test_shutdown(ui_service: UiService, ui_comm: DummyComm) -> None:
    # Double-check that the comm is not yet closed
    assert ui_service._comm is not None  # noqa: SLF001
    assert not ui_comm._closed  # noqa: SLF001

    ui_service.shutdown()

    # Comm is closed
    assert ui_comm._closed  # noqa: SLF001


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://google.com", []),
        ("localhost:8000", [show_url_event("localhost:8000")]),
        # Unix path
        (
            "file://hello/my/friend.html",
            [
                show_html_file_event(
                    "file://hello/my/friend.html", destination=ShowHtmlFileDestination.Viewer
                )
            ],
        ),
        # Windows path
        (
            "file:///C:/Users/username/Documents/index.htm",
            [
                show_html_file_event(
                    "file:///C:/Users/username/Documents/index.htm",
                    destination=ShowHtmlFileDestination.Viewer,
                )
            ],
        ),
        # Not a local html file
        ("http://example.com/page.html", []),
        # Not an html file
        ("file:///C:/Users/username/Documents/file.txt", []),
    ],
)
def test_webbrowser_open_sends_events(
    url, expected, shell: PositronShell, ui_comm: DummyComm
) -> None:
    """Test that opening different types of URLs via `webbrowser.open` sends the expected UI events."""
    if sys.platform == "win32":
        # Skip flakey windows tests for now.
        pytest.skip("Skipping test on Windows machines")
    shell.run_cell(
        f"""
import webbrowser
# Only enable the positron viewer browser; avoids system browsers opening during tests.
webbrowser._tryorder = ["positron_viewer"]
webbrowser.open({url!r})
"""
    )
    assert ui_comm.messages == expected


def test_bokeh_show_sends_events(
    shell: PositronShell,
    ui_comm: DummyComm,
) -> None:
    """Test that showing a Bokeh plot sends the expected UI events."""
    shell.run_cell(
        """\
import webbrowser
# Only enable the positron viewer browser; avoids system browsers opening during tests.
webbrowser._tryorder = ["positron_viewer"]

from bokeh.plotting import figure, show
from bokeh.io import output

output.reset_output()
p = figure()
p.line([0, 1], [2, 3])

show(p)
"""
    )
    assert len(ui_comm.messages) == 1
    params = ui_comm.messages[0]["data"]["params"]
    assert params["title"] == ""
    assert params["destination"] == "plot"
    assert params["height"] == 0
    # default behavior should be writing to temppath
    # not wherever the process is running (see patch.bokeh)
    assert tempfile.gettempdir() in params["path"]


def test_holoview_extension_sends_events(shell: PositronShell, ui_comm: DummyComm) -> None:
    """
    Test events are sent.

    Running holoviews/holoviz code that sets an extension will trigger an event on the ui comm that
    can be used on the front end to react appropriately.
    """
    res = shell.run_cell("import holoviews as hv; hv.extension('plotly')")
    res.raise_error()

    assert len(ui_comm.messages) == 1
    assert ui_comm.messages[0] == json_rpc_notification("clear_webview_preloads", {})


def test_plotly_show_sends_events(
    shell: PositronShell,
    ui_comm: DummyComm,
) -> None:
    """Test that showing a Plotly plot sends the expected UI events when using `fig.show()` and `fig`."""
    shell.run_cell(
        """\
import webbrowser
# Only enable the positron viewer browser; avoids system browsers opening during tests.
webbrowser._tryorder = ["positron_viewer"]

# override default renderer as is done in manager.ts with setting PLOTLY_RENDERER
import plotly.io as pio
pio.renderers.default = "browser"

import plotly.express as px

fig = px.bar(x=["a", "b", "c"], y=[1, 3, 2])
fig.show()
fig
"""
    )
    assert len(ui_comm.messages) == 2

    # Both fig.show() and fig should send events with cached HTML files
    for i in range(2):
        params = ui_comm.messages[i]["data"]["params"]
        assert params["title"] == ""
        assert params["destination"] == "plot"
        assert params["height"] == 0
        # Plotly HTML should be cached to a temp file (not a localhost URL)
        # so that "Open in Browser" works after Plotly's single-use server shuts down
        path = params["path"]
        assert not path.startswith("http"), f"Expected file path, got URL: {path}"
        assert path.endswith(".html"), f"Expected .html file, got: {path}"
        # On Windows, the path is a raw file path (e.g., C:\...), while on other
        # platforms it's a file:// URL. Extract the actual file path accordingly.
        file_path = Path(path.replace("file://", "")) if path.startswith("file://") else Path(path)
        assert file_path.is_file(), f"Cached HTML file should exist: {file_path}"


def test_is_not_plot_url_events(
    shell: PositronShell,
    ui_comm: DummyComm,
) -> None:
    """
    Test that opening a URL that is not a plot sends the expected UI events.

    Checks that the `destination` parameter is not set to "plot".
    """
    shell.run_cell(
        """\
import webbrowser
# Only enable the positron viewer browser; avoids system browsers opening during tests.
webbrowser._tryorder = ["positron_viewer"]

webbrowser.open("http://127.0.0.1:8000")
webbrowser.open("file://file.html")
"""
    )
    assert len(ui_comm.messages) == 2
    params = ui_comm.messages[0]["data"]["params"]
    assert params["url"] == "http://127.0.0.1:8000"
    assert "destination" not in params

    params = ui_comm.messages[1]["data"]["params"]
    assert params["path"] == "file.html" if sys.platform == "win32" else "file://file.html"
    assert params["destination"] != "plot"
