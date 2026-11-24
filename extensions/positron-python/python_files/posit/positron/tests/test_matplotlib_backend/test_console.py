#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import base64
import gc
import inspect
import io
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any, cast

import matplotlib.pyplot as plt
import pytest
from PIL import Image

from positron.matplotlib_backend.backend import Backend
from positron.matplotlib_backend.registry import registry
from positron.plot_comm import PlotRenderFormat, PlotSize, PlotUnit
from positron.plots import PlotsService
from positron.positron_ipkernel import PositronIPyKernel, _CommTarget

from ..conftest import DummyComm, PositronShell
from ..utils import (
    comm_close_message,
    json_rpc_request,
    json_rpc_response,
    percent_difference,
    run_with_metadata,
)
from .conftest import active_backend

#
# Matplotlib backend + shell + plots service integration tests.
#

TARGET_NAME = "target_name"


@pytest.fixture(autouse=True)
def setup_positron_matplotlib_backend() -> Iterator[None]:
    # The backend is set in the kernel app, which isn't currently available in our tests,
    # so set it here too.
    with active_backend(Backend.CONSOLE):
        yield


@pytest.fixture(autouse=True)
def import_pyplot(shell: PositronShell) -> None:
    # Import pyplot for convenience.
    shell.run_cell("import matplotlib.pyplot as plt")


@pytest.fixture
def plots_service(kernel: PositronIPyKernel) -> Iterable[PlotsService]:
    """The Positron plots service."""
    plots_service = kernel.plots_service

    assert not plots_service._plots  # noqa: SLF001
    assert not plt.get_fignums()

    yield plots_service

    plots_service.shutdown()
    plt.close("all")


@pytest.fixture(scope="session")
def images_path() -> Path:
    images_path = Path(__file__).parent / "images"
    images_path.mkdir(exist_ok=True)
    return images_path


def _verify_comm_open_message(message: dict[str, Any]) -> None:
    """Verify a comm_open message has expected structure, ignoring pre_render image data."""
    assert message["msg_type"] == "comm_open"
    assert message["target_name"] == _CommTarget.Plot

    data = message.get("data", {})

    # Pre-render should be present
    if "pre_render" in data:
        pre_render = data["pre_render"]
        assert "data" in pre_render  # base64-encoded image data
        assert pre_render["mime_type"] == "image/png"
        assert "settings" in pre_render
        settings = pre_render["settings"]
        assert settings["format"] == PlotRenderFormat.Png.value


def _create_mpl_plot(
    shell: PositronShell,
    plots_service: PlotsService,
    size: tuple[float, float] | None = None,
    dpi: int | None = None,
) -> DummyComm:
    args = []
    if size:
        args.append(f"figsize=({size[0]}, {size[1]})")
    if dpi:
        args.append(f"dpi={dpi}")
    args_code = ", ".join(args)

    shell.run_cell(f"plt.figure({args_code})").raise_error()
    plot_comm = cast("DummyComm", plots_service._plots[-1]._comm.comm)  # noqa: SLF001

    assert len(plot_comm.messages) == 1
    _verify_comm_open_message(plot_comm.messages[0])
    plot_comm.messages.clear()
    return plot_comm


def _verify_event_notification(message: dict[str, Any], method: str) -> None:
    """Verify an event notification has expected structure, ignoring pre_render image data."""
    assert message["msg_type"] == "comm_msg"
    data = message.get("data", {})
    assert data.get("jsonrpc") == "2.0"
    assert data.get("method") == method
    params = data.get("params", {})
    # Pre-render should be present
    if "pre_render" in params:
        pre_render = params["pre_render"]
        assert "data" in pre_render  # base64-encoded image data
        assert "mime_type" in pre_render
        assert "settings" in pre_render


def _verify_update_notification(message: dict[str, Any]) -> None:
    """Verify an update notification has expected structure."""
    _verify_event_notification(message, "update")


def _verify_show_notification(message: dict[str, Any]) -> None:
    """Verify a show notification has expected structure."""
    _verify_event_notification(message, "show")


def _do_render(
    plot_comm: DummyComm, size: PlotSize | None = None, pixel_ratio=2.0, format_="png"
) -> dict[str, Any]:
    msg = json_rpc_request(
        "render",
        {
            "size": size.dict() if size else None,
            "pixel_ratio": pixel_ratio,
            "format": format_,
        },
        comm_id="dummy_comm_id",
    )
    plot_comm.handle_msg(msg)

    assert len(plot_comm.messages) == 1
    response = plot_comm.messages[0]
    plot_comm.messages.clear()

    return response


def test_mpl_create(shell: PositronShell, plots_service: PlotsService) -> None:
    # Creating a figure should create a plot with the plots service and open a corresponding comm.
    _create_mpl_plot(shell, plots_service)

    assert len(plots_service._plots) == 1  # noqa: SLF001


def test_mpl_get_intrinsic_size(shell: PositronShell, plots_service: PlotsService) -> None:
    # Create a plot with a given size.
    intrinsic_size = (6.0, 4.0)
    plot_comm = _create_mpl_plot(shell, plots_service, intrinsic_size)

    # Send a get_intrinsic_size request to the plot comm.
    msg = json_rpc_request("get_intrinsic_size", {}, comm_id="dummy_comm_id")
    plot_comm.handle_msg(msg)

    # Check that the response includes the expected intrinsic size.
    assert plot_comm.messages == [
        json_rpc_response(
            {
                "width": intrinsic_size[0],
                "height": intrinsic_size[1],
                "unit": PlotUnit.Inches.value,
                "source": "matplotlib",
            }
        )
    ]


def test_mpl_get_metadata(shell: PositronShell, plots_service: PlotsService) -> None:
    # Create a plot.
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Send a get_metadata request to the plot comm.
    msg = json_rpc_request("get_metadata", {}, comm_id="dummy_comm_id")
    plot_comm.handle_msg(msg)

    # Check that the response includes the expected metadata.
    assert len(plot_comm.messages) == 1
    response = plot_comm.messages[0]
    result = response["data"]["result"]

    # Verify the metadata structure
    assert result["kind"] == "matplotlib"
    assert result["name"] == "matplotlib 1"
    # execution_id and code may be empty in test context since there's no real execute_request
    assert "execution_id" in result
    assert "code" in result
    # origin should be None when no code_location is provided
    assert result["origin"] is None


def test_mpl_get_metadata_with_origin(shell: PositronShell, plots_service: PlotsService) -> None:
    from positron.plot_comm import PlotOrigin, PlotRange

    # Create a plot with an explicit origin.
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Manually set the origin on the plot (simulating what the backend does
    # when a code_location is present in the execute_request).
    plot = plots_service._plots[-1]  # noqa: SLF001
    plot._origin = PlotOrigin(  # noqa: SLF001
        uri="file:///path/to/analysis.py",
        range=PlotRange(
            start_line=5,
            start_character=0,
            end_line=5,
            end_character=20,
        ),
    )

    # Send a get_metadata request to the plot comm.
    msg = json_rpc_request("get_metadata", {}, comm_id="dummy_comm_id")
    plot_comm.handle_msg(msg)

    # Check that the response includes the expected metadata with origin.
    assert len(plot_comm.messages) == 1
    response = plot_comm.messages[0]
    result = response["data"]["result"]

    assert result["origin"] is not None
    assert result["origin"]["uri"] == "file:///path/to/analysis.py"
    assert result["origin"]["range"]["start_line"] == 5
    assert result["origin"]["range"]["start_character"] == 0
    assert result["origin"]["range"]["end_line"] == 5
    assert result["origin"]["range"]["end_character"] == 20


def test_mpl_show(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Show the figure again.
    shell.run_cell("plt.show()")
    assert len(plot_comm.messages) == 1
    _verify_show_notification(plot_comm.messages[0])
    plot_comm.messages.clear()

    # It should also work with Figure.show().
    shell.run_cell("plt.gcf().show()")
    assert len(plot_comm.messages) == 1
    _verify_show_notification(plot_comm.messages[0])


def test_mpl_render(shell: PositronShell, plots_service: PlotsService, images_path: Path) -> None:
    # First create the figure and get the plot comm.
    intrinsic_size = (6.0, 4.0)
    dpi = 100
    plot_comm = _create_mpl_plot(shell, plots_service, intrinsic_size, dpi)

    # Plot some data.
    shell.run_cell("plt.gca().plot([0, 1], [0, 1])").raise_error()
    # Add text outside the default bounding box (https://github.com/posit-dev/positron/issues/5068).
    shell.run_cell("plt.gcf().text(x=0.5, y=1, s='title', size=20)").raise_error()

    # Clear update messages generated by drawing operations (tested separately in test_mpl_update).
    plot_comm.messages.clear()

    # Send a render request to the plot comm. The frontend would send this on comm creation.
    size = PlotSize(width=400, height=300)
    pixel_ratio = 2.0
    format_ = "png"
    response = _do_render(plot_comm, size, pixel_ratio, format_)

    def verify_response(
        response,
        filename: str,
        expected_size: tuple[float, float],
        threshold=0.0,
        *,
        expect_settings: bool = False,
    ):
        # Check that the response includes the expected base64-encoded resized image.
        image_bytes = response["data"]["result"].pop("data")
        image = Image.open(io.BytesIO(base64.b64decode(image_bytes)))

        # First save it to disk for manual inspection if the test fails.
        image.save(images_path / f"{filename}.png")

        # Check the format and size of the image.
        assert image.format == format_.upper()
        assert percent_difference(image.size[0], expected_size[0] * pixel_ratio) <= threshold
        assert percent_difference(image.size[1], expected_size[1] * pixel_ratio) <= threshold

        # Check the rest of the response.
        if expect_settings:
            # Pop settings for separate verification
            settings = response["data"]["result"].pop("settings")
            assert settings["size"]["width"] == size.width
            assert settings["size"]["height"] == size.height
            assert settings["pixel_ratio"] == pixel_ratio
            assert settings["format"] == format_
            assert response == json_rpc_response({"mime_type": f"image/{format_}"})
        else:
            assert response == json_rpc_response(
                {"mime_type": f"image/{format_}", "settings": None}
            )

    verify_response(
        response, "test-mpl-render-0-explicit-size", (size.width, size.height), expect_settings=True
    )

    # Now render the plot at its intrinsic size.
    # Having rendered the plot at an explicit size should not affect the intrinsic size.
    response = _do_render(plot_comm, None, pixel_ratio, format_)

    verify_response(
        response,
        "test-mpl-render-1-intrinsic-size",
        (intrinsic_size[0] * dpi, intrinsic_size[1] * dpi),
        # The size of the image isn't guaranteed when using a tight bounding box, we arbitrarily
        # check that it's within 10% of the intrinsic size in pixels.
        0.1,
    )

    # Double-check that we can still render at a requested size.
    response = _do_render(plot_comm, size, pixel_ratio, format_)
    verify_response(
        response,
        "test-mpl-render-2-explicit-size-after-intrinsic-size",
        (size.width, size.height),
        expect_settings=True,
    )


def test_mpl_pre_render_only_after_render_settings_known(
    shell: PositronShell, plots_service: PlotsService
) -> None:
    # Simulate the start of a session: no render settings are known yet. (The
    # plots service is shared across tests, so reset explicitly rather than relying
    # on test ordering.)
    plots_service._current_render_settings = None  # noqa: SLF001

    # The first plot of a session has no known frontend render settings, so its
    # comm_open must NOT carry a pre-render: an intrinsic-size pre-render would be
    # displayed and then immediately replaced by a render at the actual pane size,
    # causing a visible flash and a wasted render (see issue #13066).
    shell.run_cell("plt.figure()").raise_error()
    first_comm = cast("DummyComm", plots_service._plots[-1]._comm.comm)  # noqa: SLF001
    assert first_comm.messages[0]["msg_type"] == "comm_open"
    assert "pre_render" not in (first_comm.messages[0].get("data") or {})
    first_comm.messages.clear()

    # Render the first plot at an explicit size; this records the frontend's render
    # settings on the plots service.
    _do_render(first_comm, PlotSize(width=400, height=300))

    # A subsequent plot now has known render settings, so its comm_open SHOULD carry
    # a pre-render (at the matching size, so the frontend won't need to re-render).
    shell.run_cell("plt.figure()").raise_error()
    second_comm = cast("DummyComm", plots_service._plots[-1]._comm.comm)  # noqa: SLF001
    assert second_comm.messages[0]["msg_type"] == "comm_open"
    assert "pre_render" in (second_comm.messages[0].get("data") or {})


@pytest.mark.parametrize(
    ("code", "should_update"),
    [
        # Drawing to an active plot should trigger an update.
        ("plt.plot([1, 2])", True),
        # Executing code that doesn't draw to the active plot should not trigger an update.
        ("1", False),
        # Drawing outside the default bounding box should trigger an update.
        pytest.param(
            "plt.gcf().text(x=0.5, y=1.0, s='title')",
            True,
            marks=pytest.mark.skip(reason="Not implemented yet"),
        ),
    ],
)
def test_mpl_update(
    code: str, *, should_update: bool, shell: PositronShell, plots_service: PlotsService
) -> None:
    # Create and render a plot.
    plot_comm = _create_mpl_plot(shell, plots_service)

    _do_render(plot_comm)

    # Run some code.
    shell.run_cell(code).raise_error()

    # Check whether an update was triggered.
    if should_update:
        assert len(plot_comm.messages) == 1
        _verify_update_notification(plot_comm.messages[0])
    else:
        assert plot_comm.messages == []


def _assert_plot_comm_closed(plot_comm: DummyComm) -> None:
    assert plot_comm._closed  # noqa: SLF001
    assert plot_comm.messages == [comm_close_message()]


def test_mpl_close(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Closing the matplotlib figure via plt.close() should NOT close the comm.
    # The comm stays open so the plot remains visible in the plots pane with its
    # cached render. This avoids race conditions where RPC calls fail because the
    # comm was closed before the frontend finished processing.
    shell.run_cell("plt.close()")

    # The comm should still be open
    assert not plot_comm._closed  # noqa: SLF001
    # No close message should have been sent
    assert plot_comm.messages == []
    # The plot should still be registered with the plots service
    assert len(plots_service._plots) == 1  # noqa: SLF001


def test_mpl_close_then_frontend_close(shell: PositronShell, plots_service: PlotsService) -> None:
    """Test the full lifecycle when plt.close() is called before frontend closes the comm.

    This tests the double-close path: plt.close() destroys the matplotlib figure,
    then the frontend closes the comm which calls _on_close (calling plt.close again).
    The second plt.close should handle the already-closed figure gracefully.
    """
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Close the matplotlib figure first (destroys the figure internally)
    shell.run_cell("plt.close()")

    # Verify figure is destroyed from matplotlib's perspective
    assert plt.get_fignums() == []

    # The comm should still be open
    assert not plot_comm._closed  # noqa: SLF001

    # Now simulate the frontend closing the comm.
    # This will trigger _on_close which calls plt.close(self.num) on an already-closed figure.
    # This should not raise an error.
    plot_comm.handle_close(comm_close_message())

    # The comm should now be closed
    _assert_plot_comm_closed(plot_comm)


def _do_close(plot_comm: DummyComm) -> None:
    plot_comm.handle_close(comm_close_message())

    _assert_plot_comm_closed(plot_comm)
    plot_comm.messages.clear()


def test_mpl_frontend_close(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)
    _do_close(plot_comm)


def test_mpl_frontend_close_then_draw(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)
    _do_render(plot_comm)
    _do_close(plot_comm)

    # Drawing again should create a new figure (not re-open the old one),
    # since frontend close also closes the matplotlib figure.
    shell.run_cell("plt.plot([1, 2])")

    # Original comm stays closed
    assert plot_comm._closed  # noqa: SLF001
    assert plot_comm.messages == []

    # A new plot was created, and the closed one was unregistered
    assert len(plots_service._plots) == 1  # noqa: SLF001
    new_plot_comm = cast("DummyComm", plots_service._plots[-1]._comm.comm)  # noqa: SLF001
    assert not new_plot_comm._closed  # noqa: SLF001


def test_mpl_frontend_close_then_show(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)
    _do_render(plot_comm)
    _do_close(plot_comm)

    # Showing again does nothing since the matplotlib figure was closed.
    # plt.show() only shows existing figures, it doesn't create new ones.
    shell.run_cell("plt.show()")

    # Original comm stays closed, no new messages
    assert plot_comm._closed  # noqa: SLF001
    assert plot_comm.messages == []

    # No new plots were created, and the closed one was unregistered
    assert not plots_service._plots  # noqa: SLF001


def test_mpl_frontend_close_unregisters_plot(
    shell: PositronShell, plots_service: PlotsService
) -> None:
    """Closing a plot from the frontend drops it from the plots service, freeing its figure."""
    shell.run_cell("import weakref; fig_ref = weakref.ref(plt.figure())").raise_error()
    plot_comm = _plot_comm(plots_service, 0)
    plot_comm.messages.clear()
    _do_close(plot_comm)

    assert not plots_service._plots  # noqa: SLF001
    # The comm references the plot; ipykernel drops closed comms, so drop ours too.
    del plot_comm
    gc.collect()
    assert shell.user_ns["fig_ref"]() is None


def test_mpl_frontend_close_then_show_held_figure(
    shell: PositronShell, plots_service: PlotsService
) -> None:
    """A closed plot that is re-opened through a held figure is registered again."""
    shell.run_cell("fig = plt.figure()").raise_error()
    plot_comm = _plot_comm(plots_service, 0)
    plot_comm.messages.clear()
    _do_close(plot_comm)

    shell.run_cell("fig.show()").raise_error()

    assert not plot_comm._closed  # noqa: SLF001
    assert len(plots_service._plots) == 1  # noqa: SLF001

    # Shutdown closes the re-opened plot.
    plots_service.shutdown()
    assert plot_comm._closed  # noqa: SLF001
    assert not plots_service._plots  # noqa: SLF001


def test_mpl_multiple_figures(shell: PositronShell, plots_service: PlotsService) -> None:
    # Create two figures, and show them both.
    plot_comms = [_create_mpl_plot(shell, plots_service) for _ in range(2)]

    # Render both figures to complete their initialization.
    for plot_comm in plot_comms:
        _do_render(plot_comm)

    # Draw to the first figure.
    shell.run_cell("plt.figure(1); plt.plot([1, 2])")

    assert len(plot_comms[0].messages) == 1
    _verify_update_notification(plot_comms[0].messages[0])
    assert plot_comms[1].messages == []
    plot_comms[0].messages.clear()

    # Draw to the second figure.
    shell.run_cell("plt.figure(2); plt.plot([1, 2])")

    assert plot_comms[0].messages == []
    assert len(plot_comms[1].messages) == 1
    _verify_update_notification(plot_comms[1].messages[0])
    plot_comms[1].messages.clear()

    # Show the first figure.
    shell.run_cell("plt.figure(1).show()")

    assert len(plot_comms[0].messages) == 1
    _verify_show_notification(plot_comms[0].messages[0])
    assert plot_comms[1].messages == []
    plot_comms[0].messages.clear()

    # Show the second figure.
    shell.run_cell("plt.figure(2).show()")

    assert plot_comms[0].messages == []
    assert len(plot_comms[1].messages) == 1
    _verify_show_notification(plot_comms[1].messages[0])


def _plot_comm(plots_service: PlotsService, index: int) -> DummyComm:
    return cast("DummyComm", plots_service._plots[index]._comm.comm)  # noqa: SLF001


def _event_methods(plot_comm: DummyComm) -> list[str]:
    return [
        message["data"]["method"]
        for message in plot_comm.messages
        if message["msg_type"] == "comm_msg"
    ]


def _total_show_events(plots_service: PlotsService) -> int:
    return sum(
        _event_methods(_plot_comm(plots_service, i)).count("show")
        for i in range(len(plots_service._plots))  # noqa: SLF001
    )


_PLOT_AND_SHOW = "plt.figure(); plt.plot([1, 2]); plt.show()"


@pytest.mark.parametrize(
    "cells",
    [
        pytest.param([f"for _ in range(10):\n    {_PLOT_AND_SHOW}"], id="one_cell"),
        pytest.param([_PLOT_AND_SHOW] * 10, id="across_cells"),
    ],
)
def test_mpl_pyplot_show_sends_one_show_per_figure(
    shell: PositronShell, plots_service: PlotsService, cells: list[str]
) -> None:
    """
    `plt.show()` doesn't re-show earlier figures, so the cost of each call stays constant.

    See https://github.com/posit-dev/positron/issues/14207.
    """
    for cell in cells:
        shell.run_cell(cell).raise_error()

    assert len(plots_service._plots) == 10  # noqa: SLF001
    assert _total_show_events(plots_service) == 10


def test_mpl_pyplot_show_skips_inactive_figures(
    shell: PositronShell, plots_service: PlotsService
) -> None:
    """`plt.show()` shows only the active figure; the others are already in the Plots pane."""
    plot_comms = [_create_mpl_plot(shell, plots_service) for _ in range(2)]

    # Neither figure was shown before, but only the active figure (2) is shown.
    shell.run_cell("plt.show()").raise_error()
    assert [_event_methods(comm) for comm in plot_comms] == [[], ["show"]]
    plot_comms[1].messages.clear()

    # Activating figure 1 makes `plt.show()` select it again.
    shell.run_cell("plt.figure(1); plt.show()").raise_error()
    assert [_event_methods(comm) for comm in plot_comms] == [["show"], []]


def test_mpl_pyplot_show_updates_edited_inactive_figure(
    shell: PositronShell, plots_service: PlotsService
) -> None:
    """An edited figure that isn't active gets its update event but no show from `plt.show()`."""
    shell.run_cell("fig1 = plt.figure(); fig2 = plt.figure(); plt.show()").raise_error()
    plot_comms = [_plot_comm(plots_service, i) for i in range(2)]
    for comm in plot_comms:
        comm.messages.clear()
        _do_render(comm)

    shell.run_cell("fig1.gca().plot([1, 2]); plt.show()").raise_error()

    assert [_event_methods(comm) for comm in plot_comms] == [["update"], ["show"]]


def test_mpl_pyplot_show_updates_edited_inactive_figure_ioff(
    shell: PositronShell, plots_service: PlotsService
) -> None:
    """Outside interactive mode, `plt.show()` sends the update for an edited inactive figure."""
    with plt.ioff():
        shell.run_cell("fig1 = plt.figure(); fig2 = plt.figure(); plt.show()").raise_error()
        plot_comms = [_plot_comm(plots_service, i) for i in range(2)]
        for comm in plot_comms:
            comm.messages.clear()
            _do_render(comm)

        # Nothing redraws the edited figure until `plt.show()`.
        shell.run_cell("fig1.gca().plot([1, 2])").raise_error()
        assert [_event_methods(comm) for comm in plot_comms] == [[], []]

        shell.run_cell("plt.show()").raise_error()
        assert [_event_methods(comm) for comm in plot_comms] == [["update"], ["show"]]


def test_mpl_pyplot_show_warns_for_non_gui_figure(
    shell: PositronShell, plots_service: PlotsService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    A non-GUI figure left open across a backend switch makes `plt.show()` warn, not raise.

    This matches matplotlib's default `plt.show()`, and the Positron figure is still shown.
    """
    # On Linux, matplotlib only raises for a non-GUI figure when a display is available.
    monkeypatch.setenv("DISPLAY", ":0")
    plt.switch_backend("agg")
    plt.figure()
    plt.switch_backend(Backend.CONSOLE.full_name)
    plot_comm = _create_mpl_plot(shell, plots_service)

    with pytest.warns(UserWarning, match="non-interactive") as record:
        shell.run_cell("plt.show()").raise_error()

    # The warning points at the user's `plt.show()` call, like matplotlib's default. It must not
    # point at a Positron file: the kernel logs those warnings instead of showing them.
    warning_file = Path(record[0].filename)
    for module in (PositronIPyKernel, plt):
        assert not warning_file.is_relative_to(Path(inspect.getfile(module)).parent)
    assert _event_methods(plot_comm) == ["show"]


def test_mpl_issue_2824(shell: PositronShell, plots_service: PlotsService) -> None:
    """
    Creating a mutable collection of figures should not create a duplicate plot.

    See https://github.com/posit-dev/positron/issues/2824.
    """
    shell.run_cell("figs = [plt.figure()]")
    # This step triggers the variables service to create a snapshot, which shouldn't duplicate the plot.
    shell.run_cell("plt.show()")
    assert len(plots_service._plots) == 1  # noqa: SLF001


def test_mpl_seaborn_figure_detached_after_cell(
    shell: PositronShell, plots_service: PlotsService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    A seaborn figure is detached from matplotlib's registry after the cell.

    A re-run starts a fresh figure, while the plot stays open and renderable.

    See https://github.com/posit-dev/positron/issues/8898.
    """
    # Create the figure as if it were produced by seaborn (detection is exercised
    # separately in test_mpl_detect_library_walks_call_stack).
    monkeypatch.setattr(
        "positron.matplotlib_backend.console._detect_plotting_library", lambda: "seaborn"
    )
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Running any cell triggers the post-cell detach.
    shell.run_cell("1").raise_error()

    # The figure is removed from matplotlib's registry...
    assert plt.get_fignums() == []
    # ...but the plot remains open, registered, and renderable.
    assert len(plots_service._plots) == 1  # noqa: SLF001
    assert not plot_comm._closed  # noqa: SLF001
    assert "result" in _do_render(plot_comm)["data"]


def test_mpl_seaborn_does_not_overwrite_existing_matplotlib_figure(
    shell: PositronShell, plots_service: PlotsService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    Seaborn gets a fresh figure when it resolves axes while a matplotlib figure is active.

    It draws on the new figure instead of over the existing one (e.g. plt then sns); the
    matplotlib figure is left untouched.

    See https://github.com/posit-dev/positron/issues/8898.
    """
    # An existing matplotlib figure is active.
    _create_mpl_plot(shell, plots_service)
    assert plt.get_fignums() == [1]

    # Simulate a seaborn call resolving its axes via plt.gca().
    monkeypatch.setattr(
        "positron.matplotlib_backend.console._detect_plotting_library", lambda: "seaborn"
    )
    axes = plt.gca()

    # gca returned axes on a new figure (2), leaving the matplotlib figure (1) intact.
    assert axes.figure is plt.figure(2)
    assert plt.get_fignums() == [1, 2]


def test_mpl_matplotlib_figure_persists_after_cell(
    shell: PositronShell, plots_service: PlotsService
) -> None:
    """
    Plain matplotlib figures stay in the registry across cells.

    This is intentional cross-cell persistence; only seaborn figures are detached
    (see issue #8898).
    """
    _create_mpl_plot(shell, plots_service)  # kind defaults to "matplotlib"

    shell.run_cell("1").raise_error()

    assert plt.get_fignums() == [1]


def test_mpl_seaborn_no_duplicate_on_rerun(
    shell: PositronShell, plots_service: PlotsService
) -> None:
    """
    Re-running a seaborn axes-level plot creates a separate plot.

    It does not stack onto the previous figure (which duplicated the colorbar).

    See https://github.com/posit-dev/positron/issues/8898.
    """
    pytest.importorskip("seaborn")

    shell.run_cell("import seaborn as sns; import numpy as np").raise_error()
    code = "sns.heatmap(np.array([[1.0, 2.0], [3.0, 4.0]]))"
    shell.run_cell(code).raise_error()
    shell.run_cell(code).raise_error()

    # Two independent plots, not one figure with stacked colorbars.
    assert len(plots_service._plots) == 2  # noqa: SLF001


def test_mpl_detect_library_walks_call_stack() -> None:
    """
    Detection attributes a figure to the library on the call stack, not one merely imported.

    So importing seaborn for styling doesn't mislabel a plain matplotlib figure (which
    would otherwise be detached across cells).

    See https://github.com/posit-dev/positron/issues/8898.
    """
    from positron.matplotlib_backend.console import _detect_plotting_library

    # A plain call site is attributed to matplotlib.
    assert _detect_plotting_library() == "matplotlib"

    # A call site inside a seaborn-rooted module is attributed to seaborn. Define a
    # function whose frame reports `__name__ == "seaborn.matrix"` (mimicking sns.heatmap).
    namespace: dict[str, Any] = {"__name__": "seaborn.matrix"}
    exec("def call(detect):\n    return detect()", namespace)
    assert namespace["call"](_detect_plotting_library) == "seaborn"


def test_mpl_deactivate_restores_gca() -> None:
    """Switching away restores the original `plt.gca` that installation patched over."""
    import matplotlib.pyplot as plt

    from positron.matplotlib_backend import console

    # The autouse fixture activated the console backend, installing our redirect.
    assert console._installed_gca is not None  # noqa: SLF001
    installed_gca = plt.gca
    original_gca = console._original_gca  # noqa: SLF001

    registry.activate("agg")

    assert console._installed_gca is None  # noqa: SLF001
    assert plt.gca is original_gca
    assert plt.gca is not installed_gca


def test_mpl_shutdown(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comms = [_create_mpl_plot(shell, plots_service) for _ in range(2)]

    # Double-check that it still has plots.
    assert len(plots_service._plots) == 2  # noqa: SLF001

    # Double-check that all comms are still open.
    assert not any(comm._closed for comm in plot_comms)  # noqa: SLF001

    plots_service.shutdown()

    # Plots are closed and cleared.
    assert not plots_service._plots  # noqa: SLF001
    assert all(comm._closed for comm in plot_comms)  # noqa: SLF001


def test_plotnine_close_then_show(shell: PositronShell, plots_service: PlotsService) -> None:
    """Test that a plotnine plot renders and then closes comm correctly."""
    shell.run_cell("""\
from plotnine import ggplot, geom_point, aes, stat_smooth, facet_wrap
from plotnine.data import mtcars

(
    ggplot(mtcars, aes("wt", "mpg", color="factor(gear)"))
    + geom_point()
    + stat_smooth(method="lm")
    + facet_wrap("gear")
)\
""").raise_error()
    plot_comm = cast("DummyComm", plots_service._plots[0]._comm.comm)  # noqa: SLF001

    # Verify comm_open with pre-render data
    assert len(plot_comm.messages) == 2
    _verify_comm_open_message(plot_comm.messages[0])
    _verify_show_notification(plot_comm.messages[1])
    assert not plot_comm._closed  # noqa: SLF001


#
# Detaching figures when the source file changes.
# See https://github.com/posit-dev/positron/issues/7591.
#

FILE_A = "file:///project/a.py"
FILE_B = "file:///project/b.py"


def _run_from(code: str, uri: str | None) -> None:
    """Run a cell as if sent from the editor `uri`, or typed in the console if None."""
    positron = {"code_location": {"uri": uri}} if uri else {}
    run_with_metadata(code, positron)


def _plot_figures(plots_service: PlotsService) -> list[Any]:
    """The matplotlib figure behind each plot, in creation order."""
    return [cast("Any", plot._render).__self__.figure for plot in plots_service._plots]  # noqa: SLF001


@pytest.mark.parametrize(
    ("first_uri", "second_uri", "expect_new_figure"),
    [
        pytest.param(FILE_A, FILE_B, True, id="different-file"),
        pytest.param(FILE_A, FILE_A, False, id="same-file"),
        pytest.param(FILE_A, None, False, id="console-after-file"),
        pytest.param(None, FILE_A, False, id="file-after-console"),
        pytest.param(None, None, False, id="console-twice"),
    ],
)
def test_mpl_source_change_detaches_figures(
    first_uri: str | None,
    second_uri: str | None,
    *,
    expect_new_figure: bool,
    shell: PositronShell,  # noqa: ARG001
    plots_service: PlotsService,
) -> None:
    _run_from("plt.plot([1, 2])", first_uri)
    _run_from("plt.plot([3, 4])", second_uri)

    figures = _plot_figures(plots_service)
    assert len(figures) == (2 if expect_new_figure else 1)
    # The latest figure is the active one, and an earlier plot's comm stays open.
    assert plt.gcf() is figures[-1]
    assert not any(plot._comm.comm._closed for plot in plots_service._plots)  # noqa: SLF001


def test_mpl_console_cell_keeps_remembered_file(
    shell: PositronShell,  # noqa: ARG001
    plots_service: PlotsService,
) -> None:
    """A console cell between two runs of the same file doesn't count as a file change."""
    _run_from("plt.plot([1, 2])", FILE_A)
    _run_from("plt.title('typed in the console')", None)
    _run_from("plt.plot([3, 4])", FILE_A)

    assert len(plots_service._plots) == 1  # noqa: SLF001


def test_mpl_console_cell_between_files_keeps_file_change(
    shell: PositronShell,  # noqa: ARG001
    plots_service: PlotsService,
) -> None:
    """Code from a file after a console plot draws on it, but a second file starts anew."""
    _run_from("plt.plot([1, 2])", None)
    _run_from("plt.title('from a file')", FILE_A)
    _run_from("plt.plot([3, 4])", FILE_B)

    assert len(plots_service._plots) == 2  # noqa: SLF001


def test_mpl_run_file_twice_starts_new_figure(
    shell: PositronShell,  # noqa: ARG001
    plots_service: PlotsService,
    tmp_path: Path,
) -> None:
    """A whole-file run is a new program, even when it's the same file as the last run."""
    script = tmp_path / "script.py"
    script.write_text("import matplotlib.pyplot as plt\nplt.plot([1, 2])\n")
    uri = script.as_uri()

    _run_from(f"%run -- {script}", uri)
    _run_from(f"%run -- {script}", uri)
    assert len(plots_service._plots) == 2  # noqa: SLF001

    # Running a selection from the same file afterwards keeps the last run's figure.
    _run_from("plt.title('from a selection')", uri)
    assert len(plots_service._plots) == 2  # noqa: SLF001


def test_mpl_run_after_another_line_starts_new_figure(
    shell: PositronShell,  # noqa: ARG001
    plots_service: PlotsService,
    tmp_path: Path,
) -> None:
    """A `%run` counts as a whole-file run on any line of the cell."""
    script = tmp_path / "script.py"
    script.write_text("import matplotlib.pyplot as plt\nplt.plot([1, 2])\n")

    _run_from("plt.plot([1, 2])", None)
    _run_from(f"# rerun the script\n%run -- {script}", None)

    assert len(plots_service._plots) == 2  # noqa: SLF001


@pytest.mark.parametrize(
    "code",
    [
        pytest.param('text = """\n%run example.py\n"""', id="string"),
        pytest.param("%%writefile {tmp}/x.py\n%run example.py\n", id="writefile-body"),
        pytest.param("x = 1  # %run example.py", id="comment"),
    ],
)
def test_mpl_run_text_does_not_detach(
    code: str,
    shell: PositronShell,  # noqa: ARG001
    plots_service: PlotsService,
    tmp_path: Path,
) -> None:
    """Text that mentions `%run` without running it doesn't detach figures."""
    _run_from("plt.plot([1, 2])", FILE_A)
    _run_from(code.format(tmp=tmp_path), None)
    _run_from("plt.plot([3, 4])", FILE_A)

    assert len(plots_service._plots) == 1  # noqa: SLF001


def test_mpl_run_detection_does_not_rerun_user_transformers(shell: PositronShell) -> None:
    """Detecting `%run` doesn't run the user's input transformers a second time."""
    calls: list[list[str]] = []

    def transformer(lines: list[str]) -> list[str]:
        calls.append(lines)
        return lines

    shell.input_transformers_post.append(transformer)
    try:
        shell.run_cell("x = 1").raise_error()
    finally:
        shell.input_transformers_post.remove(transformer)

    assert len(calls) == 1


def test_mpl_selection_after_console_run_starts_new_figure(
    shell: PositronShell,  # noqa: ARG001
    plots_service: PlotsService,
    tmp_path: Path,
) -> None:
    """A selection from a file after a `%run` typed in the console doesn't reuse the run's figure."""
    script = tmp_path / "script.py"
    script.write_text("import matplotlib.pyplot as plt\nplt.plot([1, 2])\n")

    _run_from("plt.plot([1, 2])", FILE_A)
    _run_from(f"%run -- {script}", None)
    _run_from("plt.plot([3, 4])", FILE_A)

    assert len(plots_service._plots) == 3  # noqa: SLF001


_INSTALL_BACKEND = (
    "from positron.matplotlib_backend import console\nconsole.install(get_ipython())\n"
)


@pytest.mark.parametrize(
    ("next_uri", "expect_new_figure"),
    [
        pytest.param(FILE_A, False, id="same-file"),
        pytest.param(FILE_B, True, id="different-file"),
    ],
)
def test_mpl_backend_activated_by_file_cell_remembers_file(
    next_uri: str,
    *,
    expect_new_figure: bool,
    shell: PositronShell,
    plots_service: PlotsService,
) -> None:
    """
    The cell that activates the backend counts as the remembered file.

    The backend's hooks are installed partway through that cell (when it first makes a
    figure), after the cell's pre-run hooks have already fired.
    """
    from positron.matplotlib_backend import console

    _run_from("x = 1", FILE_B)
    console.uninstall(shell)

    # Install the hooks mid-cell, as making the first figure does, then plot in the same cell.
    _run_from(_INSTALL_BACKEND + "plt.plot([1, 2])", FILE_A)
    _run_from("plt.plot([3, 4])", next_uri)

    assert len(plots_service._plots) == (2 if expect_new_figure else 1)  # noqa: SLF001


def test_mpl_backend_activated_by_console_run_starts_new_figure_for_file(
    shell: PositronShell,
    plots_service: PlotsService,
    tmp_path: Path,
) -> None:
    """A file selection doesn't draw on the figure of a console `%run` that activated the backend."""
    from positron.matplotlib_backend import console

    script = tmp_path / "script.py"
    script.write_text("import matplotlib.pyplot as plt\nplt.plot([1, 2])\n")
    console.uninstall(shell)

    _run_from(_INSTALL_BACKEND + f"%run -- {script}", None)
    _run_from("plt.plot([3, 4])", FILE_A)

    assert len(plots_service._plots) == 2  # noqa: SLF001


def test_mpl_detached_figure_updates_through_held_reference(
    shell: PositronShell, plots_service: PlotsService
) -> None:
    """Editing a detached figure through a held reference still updates its plot."""
    _run_from("fig, ax = plt.subplots(); ax.plot([1, 2])", FILE_A)
    plot_comm = cast("DummyComm", plots_service._plots[0]._comm.comm)  # noqa: SLF001
    plot_comm.messages.clear()
    _do_render(plot_comm)

    # Running file B detaches the figure; the cell then edits it through `ax`.
    _run_from("ax.set_title('edited')", FILE_B)

    assert plt.get_fignums() == []
    assert shell.user_ns["fig"] is _plot_figures(plots_service)[0]
    assert len(plot_comm.messages) == 1
    _verify_update_notification(plot_comm.messages[0])


def test_mpl_detached_seaborn_figure_updates_through_held_reference(
    shell: PositronShell, plots_service: PlotsService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seaborn figures are detached after every cell, but held-reference edits still show."""
    monkeypatch.setattr(
        "positron.matplotlib_backend.console._detect_plotting_library", lambda: "seaborn"
    )
    shell.run_cell("fig, ax = plt.subplots()").raise_error()
    plot_comm = cast("DummyComm", plots_service._plots[0]._comm.comm)  # noqa: SLF001
    plot_comm.messages.clear()
    _do_render(plot_comm)

    shell.run_cell("ax.set_title('edited')").raise_error()

    assert len(plot_comm.messages) == 1
    _verify_update_notification(plot_comm.messages[0])


def test_mpl_unchanged_detached_figure_sends_no_update(
    shell: PositronShell,  # noqa: ARG001
    plots_service: PlotsService,
) -> None:
    _run_from("fig, ax = plt.subplots(); ax.plot([1, 2])", FILE_A)
    plot_comm = cast("DummyComm", plots_service._plots[0]._comm.comm)  # noqa: SLF001
    plot_comm.messages.clear()
    _do_render(plot_comm)

    _run_from("x = 1", FILE_B)

    assert plot_comm.messages == []


def test_mpl_closed_figure_not_redrawn_after_cell(
    shell: PositronShell,
    plots_service: PlotsService,  # noqa: ARG001
) -> None:
    """A figure closed with `plt.close` isn't redrawn, even if it was left stale."""
    shell.run_cell(
        "import io\n"
        "fig, ax = plt.subplots()\n"
        "ax.plot([1, 2])\n"
        "fig.savefig(io.BytesIO())\n"
        "ax.set_title('edited')\n"
        "plt.close(fig)"
    ).raise_error()

    assert shell.user_ns["fig"].stale


def test_mpl_detached_figure_closed_by_frontend_stays_closed(
    shell: PositronShell,  # noqa: ARG001
    plots_service: PlotsService,
) -> None:
    """A plot the user removed from history isn't reopened by an edit to its figure."""
    _run_from("fig, ax = plt.subplots(); ax.plot([1, 2])", FILE_A)
    plot_comm = cast("DummyComm", plots_service._plots[0]._comm.comm)  # noqa: SLF001
    plot_comm.messages.clear()
    _do_render(plot_comm)
    _run_from("x = 1", FILE_B)
    _do_close(plot_comm)

    _run_from("ax.set_title('edited')", FILE_B)

    assert plot_comm.messages == []
