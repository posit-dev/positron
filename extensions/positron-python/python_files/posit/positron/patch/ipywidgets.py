#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""
Patches for ipywidgets to improve the experience in the Positron console.

The ipywidgets `Output` widget captures output on the frontend: entering `with out:` sets
`out.msg_id`, and the frontend redirects messages with that parent ID into the widget. In the
Positron console, the frontend only creates a widget manager once a widget is displayed. Output
captured before the `Output` widget is displayed (for example, `with out: display(x)` followed by
`display(out)`) is lost. Libraries like leafmap rely on this pattern for legends and linked maps.

We patch `Output` to capture output in the kernel instead, by appending it to `out.outputs`
(like `Output.append_display_data`). The frontend then renders the outputs whenever the widget
is displayed.
"""

from __future__ import annotations

import logging
import sys
import weakref
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from ..session_mode import SessionMode

logger = logging.getLogger(__name__)

# Stack of Output widgets that are currently capturing output. The last one receives output.
_capture_stack: list[Any] = []

# The original objects that are replaced while capturing.
_originals: dict[str, Any] = {}

# Output widgets with a pending `clear_output(wait=True)`, cleared on their next output.
_clear_pending: weakref.WeakSet[Any] = weakref.WeakSet()


def is_capturing() -> bool:
    """Whether an Output widget is currently capturing output."""
    return bool(_capture_stack)


def _append_output(output: dict[str, Any]) -> None:
    """Append an output to the innermost capturing Output widget."""
    widget = _capture_stack[-1]
    if widget in _clear_pending:
        _clear_pending.discard(widget)
        widget.outputs = ()
    outputs = widget.outputs
    # Merge consecutive stream outputs with the same name, as Jupyter output areas do.
    if (
        output["output_type"] == "stream"
        and outputs
        and outputs[-1].get("output_type") == "stream"
        and outputs[-1].get("name") == output["name"]
    ):
        last = outputs[-1]
        widget.outputs = (*outputs[:-1], {**last, "text": last["text"] + output["text"]})
    else:
        widget.outputs = (*outputs, output)


class _CaptureStream:
    """A stream that appends written text to the innermost capturing Output widget."""

    def __init__(self, stream: Any, name: str) -> None:
        self._stream = stream
        self._name = name

    def write(self, text: str) -> int:
        if text:
            _append_output({"output_type": "stream", "name": self._name, "text": text})
        return len(text)

    def flush(self) -> None:
        pass

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)


def _publish(data, metadata=None, *args, update=False, **kwargs) -> None:
    if update:
        # Display updates target an existing display, pass them through.
        _originals["publish"](data, metadata, *args, update=update, **kwargs)
        return
    _append_output({"output_type": "display_data", "data": data, "metadata": metadata or {}})


def _clear_output(wait=False) -> None:  # noqa: FBT002
    widget = _capture_stack[-1]
    if wait:
        _clear_pending.add(widget)
    else:
        _clear_pending.discard(widget)
        widget.outputs = ()


def _start_capture(widget: Any) -> None:
    if not _capture_stack:
        from IPython.core.interactiveshell import InteractiveShell

        display_pub = InteractiveShell.instance().display_pub
        _originals["display_pub"] = display_pub
        _originals["publish"] = display_pub.publish
        _originals["clear_output"] = display_pub.clear_output
        _originals["stdout"] = sys.stdout
        _originals["stderr"] = sys.stderr
        display_pub.publish = _publish
        display_pub.clear_output = _clear_output
        sys.stdout = _CaptureStream(sys.stdout, "stdout")
        sys.stderr = _CaptureStream(sys.stderr, "stderr")
    _capture_stack.append(widget)


def _stop_capture() -> None:
    _capture_stack.pop()
    if not _capture_stack:
        display_pub = _originals.pop("display_pub")
        # Remove the instance attributes so the class methods are used again.
        del display_pub.publish
        del display_pub.clear_output
        _originals.pop("publish")
        _originals.pop("clear_output")
        stdout = _originals.pop("stdout")
        stderr = _originals.pop("stderr")
        # Only restore the streams if user code didn't replace them while capturing.
        if isinstance(sys.stdout, _CaptureStream):
            sys.stdout = stdout
        if isinstance(sys.stderr, _CaptureStream):
            sys.stderr = stderr


def _positron_enter(self) -> None:
    """Start capturing output into this widget's `outputs`."""
    self._flush()
    _start_capture(self)


def _positron_exit(self, etype, evalue, tb) -> Literal[True] | None:
    """Stop capturing output, capturing an error output if an exception was raised."""
    from IPython.core.getipython import get_ipython

    ip = get_ipython()
    try:
        if etype is not None and ip is not None:
            stb = ip.InteractiveTB.structured_traceback(etype, evalue, tb, tb_offset=0)
            _append_output(
                {
                    "output_type": "error",
                    "ename": etype.__name__,
                    "evalue": str(evalue),
                    "traceback": stb,
                }
            )
        self._flush()
    finally:
        # Always restore the streams and display publisher, so a failure here doesn't leave
        # all further output redirected into this widget.
        _stop_capture()
    # Suppress exceptions when in IPython, since they are shown in the widget,
    # otherwise let someone else handle it (matching ipywidgets).
    return True if etype is not None and ip is not None else None


def patch_ipywidgets_output(session_mode: SessionMode) -> None:
    """
    Patch the ipywidgets `Output` widget to capture output in the kernel.

    Args:
        session_mode: The mode that the kernel application was started in.
    """
    from ..session_mode import SessionMode

    if session_mode == SessionMode.NOTEBOOK:
        # Notebooks have a widget manager from the start, so frontend capture works.
        return

    try:
        from ipywidgets import Output
    except ImportError:
        return

    Output.__enter__ = _positron_enter
    Output.__exit__ = _positron_exit
    logger.debug("Patched ipywidgets.Output to capture output in the kernel")
