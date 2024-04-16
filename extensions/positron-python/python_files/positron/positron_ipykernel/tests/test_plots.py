#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

import base64
import io
from pathlib import Path
from typing import Iterable, List, cast

import matplotlib
import matplotlib.pyplot as plt
import pytest
from PIL import Image

from positron_ipykernel.matplotlib_backend import enable_positron_matplotlib_backend
from positron_ipykernel.plots import PlotsService
from positron_ipykernel.positron_ipkernel import PositronIPyKernel, _CommTarget

from .conftest import DummyComm, PositronShell
from .utils import (
    comm_close_message,
    comm_open_message,
    json_rpc_notification,
    json_rpc_request,
    json_rpc_response,
)

#
# Matplotlib backend + shell + plots service integration tests.
#

TARGET_NAME = "target_name"


@pytest.fixture(autouse=True)
def setup_positron_matplotlib_backend() -> None:
    enable_positron_matplotlib_backend()

    assert matplotlib.get_backend() == "module://positron_ipykernel.matplotlib_backend"
    assert matplotlib.is_interactive()


@pytest.fixture(autouse=True)
def import_pyplot(shell: PositronShell) -> None:
    # Import pyplot for convenience.
    shell.run_cell("import matplotlib.pyplot as plt")


@pytest.fixture
def plots_service(kernel: PositronIPyKernel) -> Iterable[PlotsService]:
    """
    The Positron plots service.
    """
    plots_service = kernel.plots_service

    assert not plots_service._plots

    yield plots_service

    plt.close("all")


@pytest.fixture(scope="session")
def images_path() -> Path:
    images_path = Path(__file__).parent / "images"
    images_path.mkdir(exist_ok=True)
    return images_path


def test_mpl_dont_create_plot_on_new_figure(
    shell: PositronShell, plots_service: PlotsService
) -> None:
    # Creating a figure should not yet create a plot with the plots service.
    shell.run_cell("plt.figure()")
    assert not plots_service._plots


def _get_plot_comms(plots_service: PlotsService) -> List[DummyComm]:
    return [cast(DummyComm, plot._comm.comm) for plot in plots_service._plots]


def _get_single_plot_comm(plots_service: PlotsService) -> DummyComm:
    plot_comms = _get_plot_comms(plots_service)
    assert len(plot_comms) == 1
    return plot_comms[0]


@pytest.mark.parametrize("code", ["plt.figure(); plt.show()", "plt.figure().show()"])
def test_mpl_send_open_comm_on_plt_show(
    code: str, shell: PositronShell, plots_service: PlotsService
) -> None:
    # Showing a figure should create a plot with the plots service and open a corresponding comm.
    shell.run_cell(code)
    plot_comm = _get_single_plot_comm(plots_service)
    assert plot_comm.pop_messages() == [comm_open_message(_CommTarget.Plot)]


def _create_mpl_plot(shell: PositronShell, plots_service: PlotsService) -> DummyComm:
    shell.run_cell("plt.figure().show()")
    plot_comm = _get_single_plot_comm(plots_service)
    plot_comm.messages.clear()
    return plot_comm


def test_mpl_send_show_on_successive_plt_show(
    shell: PositronShell, plots_service: PlotsService
) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Show the figure again.
    shell.run_cell("plt.show()")
    assert plot_comm.pop_messages() == [json_rpc_notification("show", {})]

    # It should also work with Figure.show().
    shell.run_cell("plt.gcf().show()")
    assert plot_comm.pop_messages() == [json_rpc_notification("show", {})]


def test_mpl_send_update_on_draw(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Drawing to an active plot should trigger an update.
    shell.run_cell("plt.plot([1, 2])")
    assert plot_comm.pop_messages() == [json_rpc_notification("update", {})]


def test_mpl_dont_send_update_on_execution(
    shell: PositronShell, plots_service: PlotsService
) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Executing code that doesn't draw to the active plot should not trigger an update.
    shell.run_cell("1")
    assert plot_comm.pop_messages() == []


def test_mpl_send_close_comm_on_plt_close(
    shell: PositronShell, plots_service: PlotsService
) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Closing the figure should close the plot and send a comm close message.
    shell.run_cell("plt.close()")
    assert plot_comm.pop_messages() == [comm_close_message()]
    assert not plots_service._plots


def test_mpl_multiple_figures(shell: PositronShell, plots_service: PlotsService) -> None:
    # Create two figures, and show them both.
    shell.run_cell("f1 = plt.figure(); f2 = plt.figure(); plt.show()")

    plot_comms = _get_plot_comms(plots_service)
    assert len(plot_comms) == 2
    for plot_comm in plot_comms:
        assert plot_comm.pop_messages() == [comm_open_message(_CommTarget.Plot)]

    # Draw to the first figure.
    shell.run_cell("plt.figure(f1); plt.plot([1, 2])")

    assert plot_comms[0].pop_messages() == [json_rpc_notification("update", {})]
    assert plot_comms[1].pop_messages() == []

    # Draw to the second figure.
    shell.run_cell("plt.figure(f2); plt.plot([1, 2])")

    assert plot_comms[0].pop_messages() == []
    assert plot_comms[1].pop_messages() == [json_rpc_notification("update", {})]

    # Show the first figure.
    shell.run_cell("f1.show()")

    assert plot_comms[0].pop_messages() == [json_rpc_notification("show", {})]
    assert plot_comms[1].pop_messages() == []

    # Show the second figure.
    shell.run_cell("f2.show()")

    assert plot_comms[0].pop_messages() == []
    assert plot_comms[1].pop_messages() == [json_rpc_notification("show", {})]


def test_mpl_render(shell: PositronShell, plots_service: PlotsService, images_path: Path) -> None:
    # First show the figure and get the plot comm.
    shell.run_cell("plt.plot([1, 2])\nplt.show()")
    plot_comm = _get_single_plot_comm(plots_service)
    assert plot_comm.pop_messages() == [
        comm_open_message(_CommTarget.Plot),
        # NOTE: The update here is unnecessary since when the frontend receives a comm open, it
        #  responds with a render request. It is probably harmless though since the frontend
        #  debounces render requests. It happens because all figures are redrawn post cell execution,
        #  when matplotlib interactive mode is enabled.
        json_rpc_notification("update", {}),
    ]

    # Send a render request to the plot comm.
    width = 400
    height = 300
    pixel_ratio = 2
    format = "png"
    msg = json_rpc_request(
        "render",
        {"width": width, "height": height, "pixel_ratio": pixel_ratio, "format": format},
        comm_id="dummy_comm_id",
    )
    plot_comm.handle_msg(msg)

    responses = plot_comm.pop_messages()
    assert len(responses) == 1
    response = responses[0]

    # Check that the response includes the expected base64-encoded resized image.
    image_bytes = response["data"]["result"].pop("data")
    image = Image.open(io.BytesIO(base64.b64decode(image_bytes)))
    assert image.format == format.upper()
    assert image.size == (width * pixel_ratio, height * pixel_ratio)
    # Save it to disk for manual inspection.
    image.save(images_path / "test-mpl-render.png")

    # Check the rest of the response.
    assert response == json_rpc_response({"mime_type": "image/png"})


def test_mpl_shutdown(shell: PositronShell, plots_service: PlotsService) -> None:
    # Create a figure and show it.
    shell.run_cell("plt.figure(); plt.figure(); plt.show()")
    plot_comms = _get_plot_comms(plots_service)

    # Double-check that it still has plots.
    assert len(plots_service._plots) == 2

    # Double-check that all comms are still open.
    assert not any(comm._closed for comm in plot_comms)

    plots_service.shutdown()

    # Plots are closed and cleared.
    assert not plots_service._plots
    assert all(comm._closed for comm in plot_comms)
