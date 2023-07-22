import codecs
import pickle
from pathlib import Path
from typing import Iterable

import matplotlib
import matplotlib.pyplot as plt
import pytest
from IPython.conftest import get_ipython
from matplotlib.figure import Figure
from matplotlib.testing.compare import compare_images
from matplotlib_inline.backend_inline import configure_inline_support

from positron.plots import BASE_DPI, PositronDisplayPublisherHook

from .conftest import DummyComm


@pytest.fixture(scope="module", autouse=True)
def setup_matplotlib() -> Iterable[None]:
    # Use IPython's `matplotlib_inline` backend
    backend = "module://matplotlib_inline.backend_inline"
    matplotlib.use(backend)

    # Enable all IPython mimetype formatters
    ip = get_ipython()
    active_types = ip.display_formatter.active_types
    ip.display_formatter.active_types = ip.display_formatter.format_types

    # Enable matplotlib IPython formatters
    configure_inline_support(ip, backend)

    yield

    # Restore the original active formatters
    ip.display_formatter.active_types = active_types


@pytest.fixture(scope="session")
def images_path() -> Path:
    images_path = Path(__file__).parent / "images"
    images_path.mkdir(exist_ok=True)
    return images_path


@pytest.fixture(scope="session")
def hook() -> PositronDisplayPublisherHook:
    return PositronDisplayPublisherHook("TARGET_NAME")


def test_hook_call_noop_on_non_display_data(hook: PositronDisplayPublisherHook) -> None:
    msg = {"msg_type": "not_display_data"}
    assert hook(msg) == msg


def test_hook_call_noop_on_no_image_png(hook: PositronDisplayPublisherHook) -> None:
    msg = {"content": {"data": {}}, "msg_type": "display_data"}
    assert hook(msg) == msg


def test_hook_call(hook: PositronDisplayPublisherHook, images_path: Path) -> None:
    plot_data = [1, 2]
    msg = {"content": {"data": {"image/png": None}}, "msg_type": "display_data"}

    # It returns `None` to indicate that it's consumed the message
    plt.plot(plot_data)
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
    # with a reference figure
    fig_encoded = hook.figures[id]
    fig: Figure = pickle.loads(codecs.decode(fig_encoded.encode(), "base64"))
    actual = images_path / "test_hook_call_actual.png"
    fig.savefig(str(actual))

    # Create the reference figure
    fig_ref: plt.figure.Figure = plt.figure()
    fig_ref.subplots().plot(plot_data)
    expected = images_path / "test_hook_call_expected.png"
    fig_ref.savefig(str(expected))

    # Compare actual versus expected figures
    err = compare_images(actual, expected, tol=0)
    assert not err


def _get_first_comm(hook: PositronDisplayPublisherHook) -> DummyComm:
    id = next(iter(hook.comms))
    comm: DummyComm = hook.comms[id]  # type: ignore
    return comm


def test_hook_handle_msg_noop_on_unknown_msg_type(hook: PositronDisplayPublisherHook) -> None:
    comm = _get_first_comm(hook)

    # Send a message with an invalid msg_type
    msg = {"content": {"comm_id": "unknown_comm_id", "data": {"msg_type": "not_render"}}}
    comm.handle_msg(msg)

    # No new messages after comm_open
    assert len(comm.messages) == 1


def test_hook_render_noop_on_unknown_comm(hook: PositronDisplayPublisherHook) -> None:
    comm = _get_first_comm(hook)

    # Send a message with a valid msg_type but invalid comm_id
    msg = {"content": {"comm_id": "unknown_comm_id", "data": {"msg_type": "render"}}}
    comm.handle_msg(msg)

    # No new messages after comm_open
    assert len(comm.messages) == 1


def test_hook_render_error_on_unknown_figure(hook: PositronDisplayPublisherHook) -> None:
    comm = _get_first_comm(hook)

    # Clear the hook's figures to simulate a missing figure
    figures = hook.figures.copy()
    hook.figures.clear()

    # Send a message with a valid msg_type and valid comm_id, but the hook now has a missing figure
    msg = {"content": {"comm_id": comm.comm_id, "data": {"msg_type": "render"}}}
    comm.handle_msg(msg)

    # Check that we receive an error reply
    reply = comm.messages[-1]
    assert reply == {
        "data": {
            "msg_type": "error",
            "message": f"Figure {comm.comm_id} not found",
        },
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }

    # Restore the hook's figures
    hook.figures = figures


def _save_base64_image(encoded: str, filename: Path) -> None:
    image = codecs.decode(encoded.encode(), "base64")
    with open(filename, "wb") as f:
        f.write(image)


def test_hook_render(hook: PositronDisplayPublisherHook, images_path: Path) -> None:
    comm = _get_first_comm(hook)

    # Send a valid render message with a custom width and height
    width_px = height_px = 100
    pixel_ratio = 1
    msg = {
        "content": {
            "comm_id": comm.comm_id,
            "data": {
                "msg_type": "render",
                "width": width_px,
                "height": height_px,
                "pixel_ratio": pixel_ratio,
            },
        }
    }
    comm.handle_msg(msg)

    # Check that the reply is a comm_msg
    reply = comm.messages[-1]
    assert reply["msg_type"] == "comm_msg"
    assert reply["buffers"] is None
    assert reply["metadata"] == {}

    # Check that the reply data is an `image` message
    image_msg = reply["data"]
    assert image_msg["msg_type"] == "image"
    assert image_msg["mime_type"] == "image/png"

    # Check that the reply data includes the expected base64-encoded resized image

    # Save the reply's image
    actual = images_path / "test_hook_render_actual.png"
    _save_base64_image(image_msg["data"], actual)

    # Create the reference figure
    dpi = BASE_DPI * pixel_ratio
    width_in = width_px / BASE_DPI
    height_in = height_px / BASE_DPI

    fig_ref: plt.figure.Figure = plt.figure()
    fig_ref.subplots().plot([1, 2])
    fig_ref.set_dpi(dpi)
    fig_ref.set_size_inches(width_in, height_in)

    # Serialize the reference figure as a base64-encoded image
    data_ref, _ = ip.display_formatter.format(fig_ref, include=["image/png"], exclude=[])  # type: ignore
    expected = images_path / "test_hook_render_expected.png"
    _save_base64_image(data_ref["image/png"], expected)

    # Compare the actual vs expected figures
    err = compare_images(actual, expected, tol=0)
    assert not err


def test_shutdown(hook: PositronDisplayPublisherHook) -> None:
    # Double-check that it still has figures and comms
    assert hook.figures
    assert hook.comms

    # Double-check that the comm is not yet closed
    comm = next(iter(hook.comms.values()))
    assert not comm._closed

    hook.shutdown()

    # Figures and comms are closed and cleared
    assert not hook.figures
    assert not hook.comms
    assert comm._closed
