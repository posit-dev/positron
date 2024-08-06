#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import base64
import io
from pathlib import Path
from typing import Any, Dict, Iterable, cast

import matplotlib
import matplotlib.pyplot as plt
import pytest
from PIL import Image

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
    # The backend is set in the kernel app, which isn't currently available in our tests,
    # so set it here too.
    matplotlib.use("module://positron_ipykernel.matplotlib_backend")


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
    assert not plt.get_fignums()

    yield plots_service

    plots_service.shutdown()
    plt.close("all")


@pytest.fixture(scope="session")
def images_path() -> Path:
    images_path = Path(__file__).parent / "images"
    images_path.mkdir(exist_ok=True)
    return images_path


def _create_mpl_plot(shell: PositronShell, plots_service: PlotsService) -> DummyComm:
    shell.run_cell("plt.figure()")
    plot_comm = cast(DummyComm, plots_service._plots[-1]._comm.comm)
    assert plot_comm.messages == [comm_open_message(_CommTarget.Plot)]
    plot_comm.messages.clear()
    return plot_comm


def _do_render(
    plot_comm: DummyComm, width=400, height=300, pixel_ratio=2.0, format="png"
) -> Dict[str, Any]:
    msg = json_rpc_request(
        "render",
        {
            "size": {
                "width": width,
                "height": height,
            },
            "pixel_ratio": pixel_ratio,
            "format": format,
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

    assert len(plots_service._plots) == 1


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
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Send a render request to the plot comm. The frontend would send this on comm creation.
    width = 400
    height = 300
    pixel_ratio = 2.0
    format = "png"
    response = _do_render(plot_comm, width, height, pixel_ratio, format)

    # Check that the response includes the expected base64-encoded resized image.
    image_bytes = response["data"]["result"].pop("data")
    image = Image.open(io.BytesIO(base64.b64decode(image_bytes)))
    assert image.format == format.upper()
    assert image.size == (width * pixel_ratio, height * pixel_ratio)
    # Save it to disk for manual inspection.
    image.save(images_path / "test-mpl-render.png")

    # Check the rest of the response.
    assert response == json_rpc_response({"mime_type": f"image/{format}"})


def test_mpl_update(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)

    _do_render(plot_comm)

    # Drawing to an active plot should trigger an update.
    shell.run_cell("plt.plot([1, 2])")
    assert plot_comm.messages == [json_rpc_notification("update", {})]
    plot_comm.messages.clear()

    # Executing code that doesn't draw to the active plot should not trigger an update.
    shell.run_cell("1")
    assert plot_comm.messages == []


def _assert_plot_comm_closed(plot_comm: DummyComm) -> None:
    assert plot_comm._closed
    assert plot_comm.messages == [comm_close_message()]


def test_mpl_close(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)

    # Closing the figure
    shell.run_cell("plt.close()")
    # should close the plot comm,
    _assert_plot_comm_closed(plot_comm)
    # but the comm should still be registered with the plots service.
    assert len(plots_service._plots) == 1


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

    assert not plot_comm._closed
    assert plot_comm.messages == [comm_open_message(_CommTarget.Plot)]


def test_mpl_frontend_close_then_show(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comm = _create_mpl_plot(shell, plots_service)
    _do_render(plot_comm)
    _do_close(plot_comm)

    # Showing again should re-open the comm
    shell.run_cell("plt.show()")

    assert not plot_comm._closed
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
    See https://github.com/posit-dev/positron/issues/2824
    """
    shell.run_cell("figs = [plt.figure()]")
    # This step triggers the variables service to create a snapshot, which shouldn't duplicate the plot.
    shell.run_cell("plt.show()")
    assert len(plots_service._plots) == 1


def test_mpl_shutdown(shell: PositronShell, plots_service: PlotsService) -> None:
    plot_comms = [_create_mpl_plot(shell, plots_service) for _ in range(2)]

    # Double-check that it still has plots.
    assert len(plots_service._plots) == 2

    # Double-check that all comms are still open.
    assert not any(comm._closed for comm in plot_comms)

    plots_service.shutdown()

    # Plots are closed and cleared.
    assert not plots_service._plots
    assert all(comm._closed for comm in plot_comms)
