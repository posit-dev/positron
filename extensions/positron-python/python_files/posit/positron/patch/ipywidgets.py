#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""
Patches for ipywidgets to improve the experience in Positron.

The ipywidgets `Output` widget captures output on the frontend: entering `with out:` sets
`out.msg_id`, and the frontend redirects messages with that parent ID into the widget. In
Positron, the frontend only creates a widget manager once a widget is displayed. Output
captured before the `Output` widget is displayed (for example, `with out: display(x)` followed by
`display(out)`) is lost. Libraries like leafmap rely on this pattern for legends and linked maps.

We patch `Output` to capture output in the kernel instead, by appending it to `out.outputs`
(like `Output.append_display_data`). The frontend then renders the outputs whenever the widget
is displayed. Captured outputs are buffered and sent to the frontend at most every
`_FLUSH_INTERVAL` seconds, and when the capture ends, since each update sends all of the
widget's outputs.
"""

from __future__ import annotations

import logging
import sys
import time
import weakref
from typing import Any, Literal

logger = logging.getLogger(__name__)

# Minimum number of seconds between updates of a capturing Output widget's `outputs`.
_FLUSH_INTERVAL = 0.5


class _Capture:
    """An Output widget that is capturing output, with outputs buffered between flushes."""

    def __init__(self, widget: Any) -> None:
        self.widget = widget
        self.outputs: list[dict[str, Any]] = list(widget.outputs)
        self._dirty = False
        self._last_flush = float("-inf")

    def changed(self) -> None:
        """Mark the outputs as changed, flushing them if the last flush was long enough ago."""
        self._dirty = True
        if time.monotonic() - self._last_flush >= _FLUSH_INTERVAL:
            self.flush()

    def flush(self) -> None:
        """Send the buffered outputs to the widget."""
        if self._dirty:
            self._dirty = False
            self.widget.outputs = tuple(self.outputs)
        self._last_flush = time.monotonic()


# Stack of Output widgets that are currently capturing output. The last one receives output.
_capture_stack: list[_Capture] = []

# The original objects that are replaced while capturing.
_originals: dict[str, Any] = {}

# Output widgets with a pending `clear_output(wait=True)`, cleared on their next output.
_clear_pending: weakref.WeakSet[Any] = weakref.WeakSet()


def is_capturing() -> bool:
    """Whether an Output widget is currently capturing output."""
    return bool(_capture_stack)


def _append_output(output: dict[str, Any]) -> None:
    """Append an output to the innermost capturing Output widget."""
    capture = _capture_stack[-1]
    outputs = capture.outputs
    if capture.widget in _clear_pending:
        _clear_pending.discard(capture.widget)
        outputs.clear()
    # Merge consecutive stream outputs with the same name, as Jupyter output areas do.
    if (
        output["output_type"] == "stream"
        and outputs
        and outputs[-1].get("output_type") == "stream"
        and outputs[-1].get("name") == output["name"]
    ):
        last = outputs[-1]
        outputs[-1] = {**last, "text": last["text"] + output["text"]}
    else:
        outputs.append(output)
    capture.changed()


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
    capture = _capture_stack[-1]
    if wait:
        _clear_pending.add(capture.widget)
    else:
        _clear_pending.discard(capture.widget)
        capture.outputs.clear()
        capture.changed()


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
    else:
        # Flush the outer capture, in case it's for the same widget.
        _capture_stack[-1].flush()
    _capture_stack.append(_Capture(widget))


def _stop_capture() -> None:
    capture = _capture_stack.pop()
    try:
        capture.flush()
    finally:
        _restore_capture()


def _restore_capture() -> None:
    if _capture_stack:
        # Reload the outer capture's outputs, in case the inner capture was for the same widget.
        outer = _capture_stack[-1]
        outer.outputs = list(outer.widget.outputs)
    else:
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


def patch_ipywidgets_output() -> None:
    """Patch the ipywidgets `Output` widget to capture output in the kernel."""
    try:
        from ipywidgets import Output
    except ImportError:
        return

    Output.__enter__ = _positron_enter
    Output.__exit__ = _positron_exit
    logger.debug("Patched ipywidgets.Output to capture output in the kernel")
