#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from importlib.util import find_spec

import pytest

from positron.positron_ipkernel import PositronShell

from ..conftest import MockSession

# Don't import holoviews here: it must be imported after the kernel starts to set up its IPython hooks.
pytestmark = pytest.mark.skipif(
    find_spec("holoviews") is None or find_spec("matplotlib") is None,
    reason="holoviews and matplotlib are required",
)


@pytest.mark.parametrize(("fmt", "mime_type"), [("png", "image/png"), ("svg", "image/svg+xml")])
def test_matplotlib_backend_displays_image(
    shell: PositronShell, session: MockSession, fmt: str, mime_type: str
) -> None:
    """Static holoviews plots are sent as images so that they are shown in the Plots pane."""
    shell.run_cell(
        f"""\
import matplotlib
matplotlib.use("agg")
import holoviews as hv
hv.extension("matplotlib")
hv.output(fig="{fmt}")
hv.Curve([1, 2, 3])
"""
    ).raise_error()

    data = [
        message["content"]["data"] for message in session.messages if "data" in message["content"]
    ]
    assert any(mime_type in d and "text/html" not in d for d in data)
