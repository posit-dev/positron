import codecs
import pickle
from pathlib import Path
from typing import Iterable, cast

import matplotlib
import matplotlib.pyplot as plt
import pytest
from IPython.conftest import get_ipython
from IPython.core.formatters import DisplayFormatter
from matplotlib.axes import Axes
from matplotlib.figure import Figure
from matplotlib.testing.compare import compare_images
from matplotlib_inline.backend_inline import configure_inline_support
from positron.plots import BASE_DPI, PositronDisplayPublisherHook

from .conftest import DummyComm

PLOT_DATA = [1, 2]


@pytest.fixture(scope="session", autouse=True)
def setup_matplotlib() -> Iterable[None]:
    # Use IPython's `matplotlib_inline` backend
    backend = "module://matplotlib_inline.backend_inline"
    matplotlib.use(backend)

    # Enable all IPython mimetype formatters
    ip = get_ipython()
    display_formatter = cast(DisplayFormatter, ip.display_formatter)
    active_types = display_formatter.active_types
    display_formatter.active_types = display_formatter.format_types

    # Enable matplotlib IPython formatters
    configure_inline_support(ip, backend)

    yield

    # Restore the original active formatters
    display_formatter.active_types = active_types


@pytest.fixture(scope="session")
def images_path() -> Path:
    images_path = Path(__file__).parent / "images"
    images_path.mkdir(exist_ok=True)
    return images_path


@pytest.fixture
def hook() -> PositronDisplayPublisherHook:
    return PositronDisplayPublisherHook("positron.plot")


@pytest.fixture
def figure_comm(hook: PositronDisplayPublisherHook) -> DummyComm:
    """
    A comm corresponding to a test figure belonging to the Positron display publisher hook.
    """
    # Initialize the hook by calling it on a figure created with the test plot data
    plt.plot(PLOT_DATA)
    msg = {"content": {"data": {"image/png": None}}, "msg_type": "display_data"}
    hook(msg)
    plt.close()

    # Return the comm corresponding to the first figure
    id = next(iter(hook.comms))
    figure_comm = cast(DummyComm, hook.comms[id])

    # Clear messages due to the comm_open
    figure_comm.messages.clear()

    return figure_comm


def test_hook_call_noop_on_non_display_data(hook: PositronDisplayPublisherHook) -> None:
    msg = {"msg_type": "not_display_data"}
    assert hook(msg) == msg
    assert hook.figures == {}
    assert hook.comms == {}


def test_hook_call_noop_on_no_image_png(hook: PositronDisplayPublisherHook) -> None:
    msg = {"content": {"data": {}}, "msg_type": "display_data"}
    assert hook(msg) == msg
    assert hook.figures == {}
    assert hook.comms == {}


def test_hook_call(hook: PositronDisplayPublisherHook, images_path: Path) -> None:
    # It returns `None` to indicate that it's consumed the message
    plt.plot(PLOT_DATA)
    msg = {"content": {"data": {"image/png": None}}, "msg_type": "display_data"}
    assert hook(msg) is None

    # It creates a new figure and comm
    assert len(hook.figures) == 1
    id = next(iter(hook.figures))
    assert id in hook.comms

    # Check the comm's properties
    comm = hook.comms[id]
    assert comm.target_name == hook.target_name
    assert comm.comm_id == id

    # Check that the figure is a pickled base64-encoded string by decoding it and comparing it
    # with a reference figure.
    # First, save the hook's figure
    fig_encoded = hook.figures[id]
    fig: Figure = pickle.loads(codecs.decode(fig_encoded.encode(), "base64"))
    actual = images_path / "test-hook-call-actual.png"
    fig.savefig(str(actual))

    # Create the reference figure
    fig_ref = cast(Figure, plt.figure())
    fig_axes = cast(Axes, fig_ref.subplots())
    fig_axes.plot(PLOT_DATA)
    expected = images_path / "test-hook-call-expected.png"
    fig_ref.savefig(str(expected))

    # Compare actual versus expected figures
    err = compare_images(str(actual), str(expected), tol=0)
    assert not err


def test_hook_handle_msg_noop_on_unknown_msg_type(figure_comm: DummyComm) -> None:
    # Handle a message with an invalid msg_type
    msg = {"content": {"comm_id": "unknown_comm_id", "data": {"msg_type": "not_render"}}}
    figure_comm.handle_msg(msg)

    # No messages sent
    assert figure_comm.messages == []


def test_hook_render_noop_on_unknown_comm(figure_comm: DummyComm) -> None:
    # Handle a message with a valid msg_type but invalid comm_id
    msg = {"content": {"comm_id": "unknown_comm_id", "data": {"msg_type": "render"}}}
    figure_comm.handle_msg(msg)

    # No messages sent
    assert figure_comm.messages == []


def test_hook_render_error_on_unknown_figure(
    hook: PositronDisplayPublisherHook, figure_comm: DummyComm
) -> None:
    # Clear the hook's figures to simulate a missing figure
    hook.figures.clear()

    # Handle a message with a valid msg_type and valid comm_id, but the hook now has a missing figure
    msg = {"content": {"comm_id": figure_comm.comm_id, "data": {"msg_type": "render"}}}
    figure_comm.handle_msg(msg)

    # Check that we receive an error reply
    assert figure_comm.messages == [
        {
            "data": {
                "msg_type": "error",
                "message": f"Figure {figure_comm.comm_id} not found",
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]


def _save_base64_image(encoded: str, filename: Path) -> None:
    image = codecs.decode(encoded.encode(), "base64")
    with open(filename, "wb") as f:
        f.write(image)


def test_hook_render(figure_comm: DummyComm, images_path: Path) -> None:
    # Send a valid render message with a custom width and height
    width_px = height_px = 100
    pixel_ratio = 1
    msg = {
        "content": {
            "comm_id": figure_comm.comm_id,
            "data": {
                "msg_type": "render",
                "width": width_px,
                "height": height_px,
                "pixel_ratio": pixel_ratio,
            },
        }
    }
    figure_comm.handle_msg(msg)

    # Check that the reply is a comm_msg
    reply = figure_comm.messages[0]
    assert reply["msg_type"] == "comm_msg"
    assert reply["buffers"] is None
    assert reply["metadata"] == {}

    # Check that the reply data is an `image` message
    image_msg = reply["data"]
    assert image_msg["msg_type"] == "image"
    assert image_msg["mime_type"] == "image/png"

    # Check that the reply data includes the expected base64-encoded resized image

    # Save the reply's image
    actual = images_path / "test-hook-render-actual.png"
    _save_base64_image(image_msg["data"], actual)

    # Create the reference figure
    dpi = BASE_DPI * pixel_ratio
    width_in = width_px / BASE_DPI
    height_in = height_px / BASE_DPI

    fig_ref = cast(Figure, plt.figure())
    fig_axes = cast(Axes, fig_ref.subplots())
    fig_axes.plot([1, 2])
    fig_ref.set_dpi(dpi)
    fig_ref.set_size_inches(width_in, height_in)

    # Serialize the reference figure as a base64-encoded image
    display_formatter = cast(DisplayFormatter, get_ipython().display_formatter)
    data_ref, _ = display_formatter.format(fig_ref, include=["image/png"], exclude=[])
    expected = images_path / "test-hook-render-expected.png"
    _save_base64_image(data_ref["image/png"], expected)

    # Compare the actual vs expected figures
    err = compare_images(str(actual), str(expected), tol=0)
    assert not err


# It's important that we depend on the figure_comm fixture too, so that the hook is initialized
def test_shutdown(hook: PositronDisplayPublisherHook, figure_comm: DummyComm) -> None:
    # Double-check that it still has figures and comms
    assert hook.figures
    assert hook.comms == {figure_comm.comm_id: figure_comm}

    # Double-check that the comm is not yet closed
    assert all(not comm._closed for comm in hook.comms.values())

    hook.shutdown()

    # Figures and comms are closed and cleared
    assert not hook.figures
    assert not hook.comms
    assert all(comm._closed for comm in hook.comms.values())
