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

from positron.plot_comm import PlotSize, PlotUnit
from positron.plots import PlotsService
from positron.positron_ipkernel import PositronIPythonKernel, _CommTarget

from .conftest import DummyComm, PositronShell
from .utils import (
    comm_close_message,
    comm_open_message,
    json_rpc_notification,
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
def plots_service(kernel: PositronIPythonKernel) -> Iterable[PlotsService]:
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
    assert plot_comm.messages == [comm_open_message(_CommTarget.Plot)]
    plot_comm.messages.clear()
    return plot_comm


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
                "source": "Matplotlib",
            }
        )
    ]


def test_mpl_show(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Show the figure again.
    shell.run_cell("plt.show()")
    assert plot_comm.messages == [json_rpc_notification("show", {})]
    plot_comm.messages.clear()

    # It should also work with Figure.show().
    shell.run_cell("plt.gcf().show()")
    assert plot_comm.messages == [json_rpc_notification("show", {})]


def test_mpl_render(shell: PositronShell, plots_service: PlotsService, images_path: Path) -> None:
    # First create the figure and get the plot comm.
    intrinsic_size = (6.0, 4.0)
    dpi = 100
    plot_comm = _create_mpl_plot(shell, plots_service, intrinsic_size, dpi)

    # Plot some data.
    shell.run_cell("plt.gca().plot([0, 1], [0, 1])").raise_error()
    # Add text outside the default bounding box (https://github.com/posit-dev/positron/issues/5068).
    shell.run_cell("plt.gcf().text(x=0.5, y=1, s='title', size=20)").raise_error()

    # Send a render request to the plot comm. The frontend would send this on comm creation.
    size = PlotSize(width=400, height=300)
    pixel_ratio = 2.0
    format_ = "png"
    response = _do_render(plot_comm, size, pixel_ratio, format_)

    def verify_response(response, filename: str, expected_size: Tuple[float, float], threshold=0.0):
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
        assert response == json_rpc_response({"mime_type": f"image/{format_}", "settings": None})

    verify_response(response, "test-mpl-render-0-explicit-size", (size.width, size.height))

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
        response, "test-mpl-render-2-explicit-size-after-intrinsic-size", (size.width, size.height)
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
    assert plot_comm.messages == ([json_rpc_notification("update", {})] if should_update else [])


def _assert_plot_comm_closed(plot_comm: DummyComm) -> None:
    assert plot_comm._closed  # noqa: SLF001
    assert plot_comm.messages == [comm_close_message()]


def test_mpl_close(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Closing the figure
    shell.run_cell("plt.close()")
    # should close the plot comm,
    _assert_plot_comm_closed(plot_comm)
    # but the comm should still be registered with the plots service.
    assert len(plots_service._plots) == 1  # noqa: SLF001


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

    # Drawing again should re-open the comm
    shell.run_cell("plt.plot([1, 2])")

    assert not plot_comm._closed  # noqa: SLF001
    assert plot_comm.messages == [comm_open_message(_CommTarget.Plot)]


def test_mpl_frontend_close_then_show(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)
    _do_render(plot_comm)
    _do_close(plot_comm)

    # Showing again should re-open the comm
    shell.run_cell("plt.show()")

    assert not plot_comm._closed  # noqa: SLF001
    assert plot_comm.messages == [comm_open_message(_CommTarget.Plot)]


def test_mpl_multiple_figures(shell: PositronShell, plots_service: PlotsService) -> None:
    # Create two figures, and show them both.
    plot_comms = [_create_mpl_plot(shell, plots_service) for _ in range(2)]

    # Render both figures to complete their initialization.
    for plot_comm in plot_comms:
        _do_render(plot_comm)

    # Draw to the first figure.
    shell.run_cell("plt.figure(1); plt.plot([1, 2])")

    assert plot_comms[0].messages == [json_rpc_notification("update", {})]
    assert plot_comms[1].messages == []
    plot_comms[0].messages.clear()

    # Draw to the second figure.
    shell.run_cell("plt.figure(2); plt.plot([1, 2])")

    assert plot_comms[0].messages == []
    assert plot_comms[1].messages == [json_rpc_notification("update", {})]
    plot_comms[1].messages.clear()

    # Show the first figure.
    shell.run_cell("plt.figure(1).show()")

    assert plot_comms[0].messages == [json_rpc_notification("show", {})]
    assert plot_comms[1].messages == []
    plot_comms[0].messages.clear()

    # Show the second figure.
    shell.run_cell("plt.figure(2).show()")

    assert plot_comms[0].messages == []
    assert plot_comms[1].messages == [json_rpc_notification("show", {})]


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

    assert plot_comm.messages == [
        comm_open_message(_CommTarget.Plot),
        json_rpc_notification("show", {}),
    ]
    assert not plot_comm._closed  # noqa: SLF001
