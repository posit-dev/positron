#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import base64
import io
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple, cast

import matplotlib
import matplotlib.pyplot as plt
import pytest
from PIL import Image

from positron.plot_comm import PlotRenderFormat, PlotSize, PlotUnit
from positron.plots import PlotsService
from positron.positron_ipkernel import PositronIPyKernel, _CommTarget

from .conftest import DummyComm, PositronShell
from .utils import (
    comm_close_message,
    json_rpc_request,
    json_rpc_response,
    percent_difference,
)

#
# Matplotlib backend + shell + plots service integration tests.
#

TARGET_NAME = "target_name"


@pytest.fixture(autouse=True)
def setup_positron_matplotlib_backend() -> None:
    # The backend is set in the kernel app, which isn't currently available in our tests,
    # so set it here too.
    matplotlib.use("module://positron.matplotlib_backend")


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


def _verify_comm_open_message(message: Dict[str, Any]) -> None:
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
    size: Optional[Tuple[float, float]] = None,
    dpi: Optional[int] = None,
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


def _verify_event_notification(message: Dict[str, Any], method: str) -> None:
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


def _verify_update_notification(message: Dict[str, Any]) -> None:
    """Verify an update notification has expected structure."""
    _verify_event_notification(message, "update")


def _verify_show_notification(message: Dict[str, Any]) -> None:
    """Verify a show notification has expected structure."""
    _verify_event_notification(message, "show")


def _do_render(
    plot_comm: DummyComm, size: Optional[PlotSize] = None, pixel_ratio=2.0, format_="png"
) -> Dict[str, Any]:
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
        expected_size: Tuple[float, float],
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

    # A new plot was created
    assert len(plots_service._plots) == 2  # noqa: SLF001
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

    # No new plots were created
    assert len(plots_service._plots) == 1  # noqa: SLF001


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


def test_mpl_issue_2824(shell: PositronShell, plots_service: PlotsService) -> None:
    """
    Creating a mutable collection of figures should not create a duplicate plot.

    See https://github.com/posit-dev/positron/issues/2824.
    """
    shell.run_cell("figs = [plt.figure()]")
    # This step triggers the variables service to create a snapshot, which shouldn't duplicate the plot.
    shell.run_cell("plt.show()")
    assert len(plots_service._plots) == 1  # noqa: SLF001


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
