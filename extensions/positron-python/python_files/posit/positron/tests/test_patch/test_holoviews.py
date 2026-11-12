#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import io
from collections.abc import Iterator
from importlib.util import find_spec

import pytest

from positron.matplotlib_backend.backend import Backend
from positron.plot_comm import PlotSize
from positron.plots import PlotsService
from positron.positron_ipkernel import PositronIPyKernel, PositronShell

from ..conftest import MockSession
from ..test_matplotlib_backend.conftest import active_backend

# Don't import holoviews here: it must be imported after the kernel starts to set up its IPython hooks.
pytestmark = pytest.mark.skipif(
    find_spec("holoviews") is None or find_spec("matplotlib") is None,
    reason="holoviews and matplotlib are required",
)


@pytest.fixture
def plots_service(kernel: PositronIPyKernel) -> Iterator[PlotsService]:
    # `hv.extension("matplotlib")` switches the matplotlib backend, so restore it afterwards.
    with active_backend(Backend.CONSOLE):
        yield kernel.plots_service

    kernel.plots_service.shutdown()


def _displayed_data(session: MockSession) -> list[dict]:
    return [
        message["content"]["data"] for message in session.messages if "data" in message["content"]
    ]


@pytest.mark.parametrize("fmt", ["png", "svg"])
def test_matplotlib_backend_shows_in_plots_pane(
    shell: PositronShell, session: MockSession, plots_service: PlotsService, fmt: str
) -> None:
    """Static holoviews matplotlib plots are shown in the Plots pane and not in the console."""
    shell.run_cell(f'import holoviews as hv; hv.extension("matplotlib"); hv.output(fig="{fmt}")')
    session.messages.clear()

    shell.run_cell("hv.Curve([1, 2, 3])").raise_error()

    plots = plots_service._plots  # noqa: SLF001
    assert [plot._kind for plot in plots] == ["HoloViews"]  # noqa: SLF001
    assert _displayed_data(session) == []

    # The plot renders at the requested size.
    from PIL import Image

    rendered = plots[0]._render(PlotSize(width=400, height=300), 2.0, "png")  # noqa: SLF001
    assert Image.open(io.BytesIO(rendered)).size == (800, 600)


def test_bokeh_backend_is_unchanged(
    shell: PositronShell, session: MockSession, plots_service: PlotsService
) -> None:
    """Interactive holoviews plots are not sent through the plots service."""
    shell.run_cell('import holoviews as hv; hv.extension("bokeh")')
    session.messages.clear()

    shell.run_cell("hv.Curve([1, 2, 3])").raise_error()

    assert plots_service._plots == []  # noqa: SLF001
    # The frontend requires all of these to show the plot in the Plots pane.
    mime_types = {"text/html", "text/plain", "application/vnd.holoviews_exec.v0+json"}
    assert any(mime_types <= data.keys() for data in _displayed_data(session))
