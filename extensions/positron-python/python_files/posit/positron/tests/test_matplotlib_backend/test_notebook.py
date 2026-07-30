#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import base64
from typing import TYPE_CHECKING

import matplotlib
import pytest
from IPython.core.display import _pngxy
from IPython.utils.capture import RichOutput, capture_output

from positron.matplotlib_backend.backend import Backend
from positron.session_mode import SessionMode

from ..utils import run_with_metadata
from .conftest import active_backend

if TYPE_CHECKING:
    from matplotlib.figure import Figure

    from positron.positron_ipkernel import PositronShell


DEFAULT_FIGSIZE: list[float] = matplotlib.rcParamsDefault["figure.figsize"]


@pytest.fixture(autouse=True)
def _setup(shell, monkeypatch):
    """Configure the shell to match the notebook environment."""
    monkeypatch.setattr(shell, "session_mode", SessionMode.NOTEBOOK)


@pytest.fixture
def backend(shell):
    """A fixture that configures matplotlib to use the Positron notebook backend."""
    with active_backend(Backend.NOTEBOOK):
        yield NotebookBackendFixture(shell)


def _parse_png_output(output: RichOutput) -> tuple[bytes, dict]:
    result = output._repr_png_()
    assert result is not None, "Expected a PNG output, but got None."
    data, metadata = result if len(result) == 2 else (result, {})
    png = base64.b64decode(data)
    return png, metadata


class PlotResult:
    def __init__(self, figure: Figure, png: bytes, metadata: dict):
        self.figure = figure
        self.png = png
        self.metadata = metadata

    @property
    def figure_size(self):
        return self.figure.get_size_inches().tolist()

    @property
    def png_pixel_size(self):
        return _pngxy(self.png)


class NotebookBackendFixture:
    def __init__(self, shell: PositronShell) -> None:
        self.shell = shell

    def import_matplotlib(self) -> None:
        self.shell.run_cell("import matplotlib.pyplot as plt").raise_error()

    def plot(
        self,
        *,
        do_import=True,
        figsize: tuple[float, float] | None = None,
        meta: dict | None = None,
    ):
        # Create the code snippet.
        lines = []
        if do_import:
            lines.append("import matplotlib.pyplot as plt")
        subplots_args = f"figsize={figsize}" if figsize is not None else ""
        lines.append(f"fig, ax = plt.subplots({subplots_args})")
        lines.append("ax.plot([0, 1], [0, 1])")
        code = "\n".join(lines)

        # Run the code and capture the output.
        with capture_output() as captured:
            run_with_metadata(code, meta)

        # Return the created plot.
        assert len(captured.outputs) == 1
        png, metadata = _parse_png_output(captured.outputs[0])
        return PlotResult(figure=self.shell.user_ns["fig"], png=png, metadata=metadata)


def test_backend_activates(backend):  # noqa: ARG001
    assert matplotlib.get_backend() == "module://positron.matplotlib_backend.notebook"


def test_figure_size_set_when_matplotlib_already_imported(backend):
    """A figure made after matplotlib was imported in an earlier cell is resized."""
    # NOTE: We can't easily guarantee that matplotlib isn't imported since our tests use
    #       an in-process shell that shares imported modules with the test runner.
    #       This also makes it hard to test the case where matplotlib is imported
    #       in the same cell as the figure is created - so we test that manually for now.
    backend.import_matplotlib()
    result = backend.plot(do_import=False, meta={"fig-width": 8, "fig-height": 4})

    assert result.figure_size == [8.0, 4.0]


def test_explicit_figsize_wins(backend):
    """An explicit figsize in the cell beats the pending default."""
    result = backend.plot(figsize=(1, 1), meta={"fig-width": 8, "fig-height": 4})
    assert result.figure_size == [1.0, 1.0]


def test_figure_size_does_not_leak_to_later_cell(backend):
    """A sized cell does not leak into a later unsized cell."""
    backend.plot(meta={"fig-width": 8, "fig-height": 4})
    assert backend.plot().figure_size == DEFAULT_FIGSIZE


@pytest.mark.parametrize(
    "meta",
    [
        # Lone dimension is a no-op.
        {"fig-width": 1},
        {"fig-height": 1},
        # Non-positive dimension is a no-op.
        {"fig-width": 0},
        {"fig-height": 0},
        {"fig-width": -1},
    ],
)
def test_figure_size_noop(backend, meta):
    """A lone fig-height leaves the figure at the default size."""
    assert backend.plot(meta=meta).figure_size == DEFAULT_FIGSIZE


def test_pixel_ratio_scales_png_size_and_attaches_metadata(backend):
    """A pixel ratio scales the pixels, not the figure's inch size."""
    base = backend.plot(meta={"fig-width": 8, "fig-height": 4, "output_pixel_ratio": 1})
    scaled = backend.plot(meta={"fig-width": 8, "fig-height": 4, "output_pixel_ratio": 2})

    # The requested inch size is honored regardless of the pixel ratio.
    assert base.figure_size == [8.0, 4.0]
    assert scaled.figure_size == [8.0, 4.0]
    # Physical pixels ~double ...
    assert scaled.png_pixel_size[0] == pytest.approx(2 * base.png_pixel_size[0], abs=5)
    assert scaled.png_pixel_size[1] == pytest.approx(2 * base.png_pixel_size[1], abs=5)
    # ... while the reported logical size stays at the 1x pixel size.
    assert scaled.metadata["width"] == pytest.approx(base.png_pixel_size[0], abs=5)
    assert scaled.metadata["height"] == pytest.approx(base.png_pixel_size[1], abs=5)


def test_pixel_ratio_missing_is_noop(backend):
    """ratio=1 produces the same output as no ratio at all."""
    result = backend.plot()

    assert "width" not in result.metadata
    assert "height" not in result.metadata


def test_pixel_ratio_one_is_noop(backend):
    """ratio=1 produces the same output as no ratio at all."""
    base = backend.plot()
    scaled = backend.plot(meta={"output_pixel_ratio": 1})

    assert scaled.figure_size == DEFAULT_FIGSIZE
    assert scaled.png_pixel_size == base.png_pixel_size
    assert "width" not in scaled.metadata
    assert "height" not in scaled.metadata


@pytest.mark.parametrize("ratio", [0, -1])
def test_pixel_ratio_zero_raises(backend, ratio):
    with pytest.raises(ValueError):
        backend.plot(meta={"output_pixel_ratio": ratio})


# TODO: Test plt.show and other apis, display(fig)?
