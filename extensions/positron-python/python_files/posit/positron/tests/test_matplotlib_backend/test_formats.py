#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
Tests for `set_matplotlib_formats` support in Positron's notebook matplotlib backend.

Exercises `matplotlib_backend/formats.py`: format selection and aliasing
(`retina`/`png2x` -> `png`), kwargs passthrough, the `set_matplotlib_formats` patch's
`from`-import binding, and that a format selection survives a round trip through a
non-Positron backend.
"""

from __future__ import annotations

import base64
import io
from typing import TYPE_CHECKING, Iterator

import matplotlib
import pytest
from IPython.core.display import _jpegxy, _pngxy
from IPython.utils.capture import RichOutput, capture_output
from matplotlib.backends.backend_agg import FigureCanvasAgg
from PIL import Image

from positron.matplotlib_backend import Backend, configure_positron_support, formats
from positron.session_mode import SessionMode

from ..utils import run_with_metadata
from .conftest import active_backend

if TYPE_CHECKING:
    from positron.positron_ipkernel import PositronShell

# The `from`-import form IPython's own docs recommend, which binds whatever
# `matplotlib_inline.backend_inline.set_matplotlib_formats` is at import time.
_IMPORT_SET_FORMATS = "from matplotlib_inline.backend_inline import set_matplotlib_formats"

_PLOT_CODE = "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nax.plot([0, 1], [0, 1])"


@pytest.fixture(autouse=True)
def _setup(shell, monkeypatch):
    """Configure the shell to match the notebook environment."""
    monkeypatch.setattr(shell, "session_mode", SessionMode.NOTEBOOK)


@pytest.fixture
def backend(shell: PositronShell) -> Iterator[PositronShell]:
    """A fixture that configures matplotlib to use the Positron notebook backend."""
    with active_backend(Backend.NOTEBOOK):
        yield shell

    # `_selected_formats` is module state that intentionally survives a backend round
    # trip (see `test_preference_survives_backend_round_trip`), so it doesn't reset
    # itself on `deactivate`. Reset it here to the default so a format selected in one
    # test doesn't leak into the next (e.g. other test files' `backend` fixtures expect
    # `png` on activation).
    formats._selected_formats.clear()  # noqa: SLF001
    formats._selected_formats.add("png")  # noqa: SLF001


def _set_formats(shell: PositronShell, call: str) -> None:
    """Run `set_matplotlib_formats(...)` via the `from`-import path IPython documents."""
    shell.run_cell(f"{_IMPORT_SET_FORMATS}\n{call}").raise_error()


def _plot(*, meta: dict | None = None) -> RichOutput:
    """Run a cell that creates a figure and return its single captured display output."""
    with capture_output() as captured:
        run_with_metadata(_PLOT_CODE, meta)
    assert len(captured.outputs) == 1
    return captured.outputs[0]


def test_svg(backend: PositronShell):
    """`set_matplotlib_formats('svg')` displays only svg, decoded as utf-8 text."""
    _set_formats(backend, "set_matplotlib_formats('svg')")

    output = _plot()

    assert "image/svg+xml" in output.data
    assert "image/png" not in output.data
    assert isinstance(output.data["image/svg+xml"], str)


def test_retina_aliases_to_png(backend: PositronShell):
    """
    `retina` still renders as `image/png`, at Positron's own device pixel ratio.

    Unlike IPython's `retina_figure` (a hardcoded 2x dpi-doubling on top of Positron's
    own DPR handling), Positron already renders at the frontend's actual pixel ratio,
    so `retina` is a no-op alias to `png`: the reported logical size matches a ratio=1
    render regardless of the requested ratio, and the actual pixel size scales with
    the ratio rather than a hardcoded 2x.

    Uses ratio=3 (not 2): IPython's fixed 2x doubling would coincidentally produce
    the same numbers at ratio=2, masking a regression back to the old behavior.
    """
    _set_formats(backend, "set_matplotlib_formats('retina')")

    baseline = _plot(meta={"output_pixel_ratio": 1})
    baseline_w, baseline_h = _pngxy(base64.b64decode(baseline.data["image/png"]))

    ratio = 3
    output = _plot(meta={"output_pixel_ratio": ratio})

    assert "image/png" in output.data
    assert "image/jpeg" not in output.data
    w, h = _pngxy(base64.b64decode(output.data["image/png"]))
    metadata = output.metadata.get("image/png", {})
    # Actual pixels scale with the requested ratio ...
    assert w == pytest.approx(ratio * baseline_w, abs=5)
    assert h == pytest.approx(ratio * baseline_h, abs=5)
    # ... but the reported logical size stays at the ratio=1 size.
    assert metadata["width"] == pytest.approx(baseline_w, abs=5)
    assert metadata["height"] == pytest.approx(baseline_h, abs=5)


def test_jpeg_with_pixel_ratio(backend: PositronShell):
    """`jpeg` output is present and its metadata reflects the requested pixel ratio."""
    _set_formats(backend, "set_matplotlib_formats('jpeg')")

    output = _plot(meta={"output_pixel_ratio": 2})

    assert "image/jpeg" in output.data
    jpeg = base64.b64decode(output.data["image/jpeg"])
    w, h = _jpegxy(jpeg)
    metadata = output.metadata.get("image/jpeg", {})
    assert metadata["width"] == pytest.approx(w / 2, abs=5)
    assert metadata["height"] == pytest.approx(h / 2, abs=5)


def test_multiple_formats(backend: PositronShell):
    """`set_matplotlib_formats('png', 'svg')` displays both mimes in one output."""
    _set_formats(backend, "set_matplotlib_formats('png', 'svg')")

    output = _plot()

    assert "image/png" in output.data
    assert "image/svg+xml" in output.data


def test_unknown_format_raises(backend: PositronShell):
    """An unrecognized format raises `ValueError`, matching IPython's contract."""
    with pytest.raises(ValueError):
        _set_formats(backend, "set_matplotlib_formats('bmp')")


def test_kwargs_passthrough(backend: PositronShell, monkeypatch: pytest.MonkeyPatch):
    """Explicit kwargs (e.g. `pil_kwargs`) reach `canvas.print_figure`."""
    # Asserting on the rendered jpeg bytes would be flaky (encoder-dependent), so spy on
    # the call instead.
    calls: list[dict] = []
    original_print_figure = FigureCanvasAgg.print_figure

    def spy(self, *args, **kwargs):
        calls.append(kwargs)
        return original_print_figure(self, *args, **kwargs)

    monkeypatch.setattr(FigureCanvasAgg, "print_figure", spy)

    _set_formats(backend, "set_matplotlib_formats('jpeg', pil_kwargs={'quality': 90})")
    _plot()

    assert len(calls) == 1
    assert calls[0]["pil_kwargs"] == {"quality": 90}


def test_from_import_binding(backend: PositronShell):
    """
    `from matplotlib_inline.backend_inline import set_matplotlib_formats` binds ours.

    The `from`-import binds whatever the module attribute is at import time, which is
    already Positron's patch: it's installed at backend activation, before any user
    code runs.
    """
    _set_formats(backend, "set_matplotlib_formats('svg')")

    output = _plot()

    assert "image/svg+xml" in output.data
    # If IPython's own formatters had been installed instead, `image/png` would also
    # be present (upstream's `select_figure_formats` only touches formats you ask for,
    # but never registers ours, so this also confirms the request routed to Positron's
    # `_display_figure` and not upstream's `print_figure`).
    assert "image/png" not in output.data


def test_savefig_facecolor_rcparam_is_ignored(backend: PositronShell):
    """Inline output uses the figure's own facecolor, not `savefig.facecolor`, matching Jupyter."""
    try:
        backend.run_cell(
            "import matplotlib.pyplot as plt\nplt.rcParams['savefig.facecolor'] = 'red'"
        ).raise_error()
        output = _plot()
        png = base64.b64decode(output.data["image/png"])
        image = Image.open(io.BytesIO(png)).convert("RGB")
        # The corner comes from the figure's default facecolor, not the red rcParam.
        assert image.getpixel((0, 0)) != (255, 0, 0)
    finally:
        # rcParams are process-global and shared with the test shell; restore.
        matplotlib.rcParams["savefig.facecolor"] = matplotlib.rcParamsDefault["savefig.facecolor"]


def test_preference_survives_backend_round_trip(backend: PositronShell):
    """A format selection survives deactivating and reactivating the notebook backend."""
    _set_formats(backend, "set_matplotlib_formats('svg')")

    # Simulate switching to a non-Positron backend and back (e.g. `%matplotlib qt` then
    # `%matplotlib inline`).
    configure_positron_support("agg")
    configure_positron_support(Backend.NOTEBOOK)

    output = _plot()

    assert "image/svg+xml" in output.data
