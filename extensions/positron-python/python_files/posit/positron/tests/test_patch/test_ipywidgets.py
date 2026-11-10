#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import sys

import pytest

from positron.positron_ipkernel import PositronShell

from ..conftest import MockSession

pytest.importorskip("ipywidgets")


def _iopub_msg_types(session: MockSession) -> list[str]:
    return [msg["msg_type"] for msg in session.messages]


def test_output_captures_display_in_kernel(shell: PositronShell, session: MockSession) -> None:
    shell.run_cell(
        """\
import ipywidgets as w
from IPython.display import display
out = w.Output()
html = w.HTML('<b>hi</b>')
with out:
    display(html)
"""
    )
    out = shell.user_ns["out"]
    html = shell.user_ns["html"]

    assert out.msg_id == ""
    assert out.outputs == (
        {
            "output_type": "display_data",
            "data": {
                "text/plain": "HTML(value='<b>hi</b>')",
                "application/vnd.jupyter.widget-view+json": {
                    "version_major": 2,
                    "version_minor": 0,
                    "model_id": html.model_id,
                },
            },
            "metadata": {},
        },
    )
    # The display was captured instead of being sent to the frontend.
    assert "display_data" not in _iopub_msg_types(session)


def test_output_captures_streams(shell: PositronShell) -> None:
    shell.run_cell(
        """\
import sys
import ipywidgets as w
out = w.Output()
with out:
    print('a')
    print('b')
    print('c', file=sys.stderr)
"""
    )
    assert shell.user_ns["out"].outputs == (
        {"output_type": "stream", "name": "stdout", "text": "a\nb\n"},
        {"output_type": "stream", "name": "stderr", "text": "c\n"},
    )


def test_output_restores_capture_state(shell: PositronShell) -> None:
    stdout, stderr = sys.stdout, sys.stderr
    shell.run_cell(
        """\
import ipywidgets as w
outer = w.Output()
inner = w.Output()
with outer:
    print('outer')
    with inner:
        print('inner')
    print('outer again')
"""
    )
    assert shell.user_ns["outer"].outputs == (
        {"output_type": "stream", "name": "stdout", "text": "outer\nouter again\n"},
    )
    assert shell.user_ns["inner"].outputs == (
        {"output_type": "stream", "name": "stdout", "text": "inner\n"},
    )
    assert sys.stdout is stdout
    assert sys.stderr is stderr
    assert "publish" not in vars(shell.display_pub)
    assert "clear_output" not in vars(shell.display_pub)


@pytest.mark.parametrize(
    ("code", "expected_text"),
    [
        ("out.clear_output()\nwith out:\n    print('b')", "b\n"),
        ("out.clear_output(wait=True)\nwith out:\n    print('b')", "b\n"),
        ("with out:\n    print('b')", "a\nb\n"),
    ],
)
def test_output_clear_output(shell: PositronShell, code: str, expected_text: str) -> None:
    shell.run_cell("import ipywidgets as w\nout = w.Output()\nwith out:\n    print('a')")
    shell.run_cell(code)
    assert shell.user_ns["out"].outputs == (
        {"output_type": "stream", "name": "stdout", "text": expected_text},
    )


def test_output_clear_output_wait_keeps_outputs_until_new_output(shell: PositronShell) -> None:
    shell.run_cell(
        "import ipywidgets as w\nout = w.Output()\nwith out:\n    print('a')\n"
        "out.clear_output(wait=True)"
    )
    assert shell.user_ns["out"].outputs == (
        {"output_type": "stream", "name": "stdout", "text": "a\n"},
    )


def test_output_captures_error(shell: PositronShell) -> None:
    shell.run_cell(
        """\
import ipywidgets as w
out = w.Output()
with out:
    raise ValueError('boom')
after = True
"""
    )
    # The exception is suppressed, matching ipywidgets.
    assert shell.user_ns["after"] is True
    (output,) = shell.user_ns["out"].outputs
    assert output["output_type"] == "error"
    assert output["ename"] == "ValueError"
    assert output["evalue"] == "boom"
    assert output["traceback"]
