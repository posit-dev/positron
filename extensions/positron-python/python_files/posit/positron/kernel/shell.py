#
# Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING, cast

import traitlets
from ipykernel.zmqshell import ZMQDisplayPublisher, ZMQInteractiveShell
from IPython.core import page
from IPython.core.oinspect import InspectColors
from IPython.utils import PyColorize

from . import osc8
from .formatters import PositronDisplayFormatter
from .inspector import PositronIPythonInspector
from .magic import PositronMagics
from .session_mode import SessionMode

if TYPE_CHECKING:
    from IPython.core.interactiveshell import ExecutionInfo, ExecutionResult
    from IPython.core.magic import MagicsManager

    from .ipkernel import PositronIPythonKernel

import logging

logger = logging.getLogger(__name__)

_traceback_file_link_re = re.compile(r"^(File \x1b\[\d+;\d+m)(.+):(\d+)")


def _add_osc8_link(match: re.Match) -> str:
    """Convert a link matched by `_traceback_file_link_re` to an OSC8 link."""
    pre, path, line = match.groups()
    abs_path = Path(path).expanduser()
    try:
        uri = abs_path.as_uri()
    except ValueError:
        # The path might be like '<ipython-...>' which raises a ValueError on as_uri().
        return match.group(0)
    return pre + osc8.link(uri, f"{path}:{line}", {"line": line})


class PositronShell(ZMQInteractiveShell):
    kernel: PositronIPythonKernel
    object_info_string_level: int
    magics_manager: MagicsManager
    display_pub: ZMQDisplayPublisher
    display_formatter: PositronDisplayFormatter = traitlets.Instance(PositronDisplayFormatter)  # type: ignore

    inspector_class: type[PositronIPythonInspector] = traitlets.Type(
        PositronIPythonInspector,  # type: ignore
        help="Class to use to instantiate the shell inspector",
    ).tag(config=True)

    # Positron-specific attributes:
    session_mode: SessionMode = SessionMode.trait()  # type: ignore

    def __init__(self, *args, **kwargs):
        # Set custom attributes from the parent object.
        # It would be better to pass these as explicit arguments, but there's no easy way
        # to override the parent to do that.
        parent = cast("PositronIPythonKernel", kwargs["parent"])
        self.session_mode = parent.session_mode

        super().__init__(*args, **kwargs)

    def init_events(self) -> None:
        super().init_events()

        # Register event handlers to poll the user's environment before and after each execution.
        # Use pre/post_run_cell instead of pre/post_execute to only trigger on "interactive"
        # executions i.e. by the user and not by the kernel.
        # See: https://ipython.readthedocs.io/en/stable/config/callbacks.html.
        self.events.register("pre_run_cell", self._handle_pre_run_cell)
        self.events.register("post_run_cell", self._handle_post_run_cell)

    @traitlets.observe("colors")
    def init_inspector(self, changes: traitlets.Bunch | None = None) -> None:  # noqa: ARG002
        # TODO: This broke recently... Add some tests and fix it
        # Override to pass `parent=self` to the inspector so that the inspector can send messages
        # over the kernel's comms.
        self.inspector = self.inspector_class(
            InspectColors,
            PyColorize.ANSICodeColors,
            self.colors,
            self.object_info_string_level,
            parent=self,
        )

    def init_hooks(self):
        super().init_hooks()

        # For paged output, send display_data messages instead of using the legacy "payload"
        # functionality of execute_reply messages. The priority of 90 is chosen arbitrarily, as long
        # as its lower than other hooks registered by IPython and ipykernel.
        self.set_hook("show_in_pager", page.as_hook(page.display_page), 90)

    def init_magics(self):
        super().init_magics()

        # Register Positron's custom magics.
        self.register_magics(PositronMagics)

    def init_user_ns(self):
        super().init_user_ns()

        # Use Positron's help service
        self.user_ns_hidden["help"] = help
        self.user_ns["help"] = help

        # These variables are added to user_ns but not user_ns_hidden by ipython/ipykernel, fix that
        self.user_ns_hidden.update(
            {
                "_exit_code": {},
                "__pydevd_ret_val_dict": {},
                "__warningregistry__": {},
                "__nonzero__": {},
            }
        )

    def init_display_formatter(self):
        self.display_formatter = PositronDisplayFormatter(parent=self)
        self.configurables.append(self.display_formatter)  # type: ignore IPython type annotation is wrong

    def _handle_pre_run_cell(self, info: ExecutionInfo) -> None:
        """Prior to execution, reset the user environment watch state."""
        # If an empty cell is being executed, do nothing.
        raw_cell = cast("str", info.raw_cell)
        if not raw_cell or raw_cell.isspace():
            return

        try:
            self.kernel.variables_service.snapshot_user_ns()
        except Exception:
            logger.warning("Failed to snapshot user namespace", exc_info=True)

    def _handle_post_run_cell(self, result: ExecutionResult) -> None:
        """
        Send a msg.

        After execution, sends an update message to the client to summarize
        the changes observed to variables in the user's environment.
        """
        # If an empty cell was executed, do nothing.
        info = cast("ExecutionInfo", result.info)
        raw_cell = cast("str", info.raw_cell)
        if not raw_cell or raw_cell.isspace():
            return

        # TODO: Split these to separate callbacks?
        # Check for changes to the working directory
        try:
            self.kernel.ui_service.poll_working_directory()
        except Exception:
            logger.exception("Error polling working directory")

        try:
            self.kernel.variables_service.poll_variables()
        except Exception:
            logger.exception("Error polling variables")

    async def _stop(self):
        # Initiate the kernel shutdown sequence.
        await self.kernel.do_shutdown(restart=False)

        # Stop the main event loop.
        self.kernel.io_loop.stop()

    def show_usage(self):
        """Show a usage message."""
        self.kernel.help_service.show_help("positron.utils.positron_ipykernel_usage")

    @traitlets.observe("exit_now")
    def _update_exit_now(self, change):
        """Stop eventloop when exit_now fires."""
        if change["new"]:
            if hasattr(self.kernel, "io_loop"):
                loop = self.kernel.io_loop
                # --- Start Positron ---
                # This is reached when a user types `quit` or `exit` into the Positron Console.
                # Perform a full kernel shutdown sequence before stopping the loop.
                # TODO: We'll need to update this once Positron has a way for kernels to kick off
                # Positron's shutdown sequencing. Currently, this is seen as a kernel crash.
                # See: https://github.com/posit-dev/positron/issues/628.
                loop.call_later(0.1, self._stop)
                # --- End Positron ---
            if self.kernel.eventloop:
                exit_hook = getattr(self.kernel.eventloop, "exit_hook", None)
                if exit_hook:
                    exit_hook(self.kernel)

    def _showtraceback(self, etype, evalue: Exception, stb: list[str]):  # type: ignore IPython type annotation is wrong
        """Enhance tracebacks for the Positron frontend."""
        if self.session_mode == SessionMode.NOTEBOOK:
            # Don't modify the traceback in a notebook. The frontend assumes that it's unformatted
            # and applies its own formatting.
            return super()._showtraceback(etype, evalue, stb)  # type: ignore IPython type annotation is wrong

        # Remove the first two lines of the traceback, which are the "---" header and the repeated
        # exception name and "Traceback (most recent call last)".
        # Also remove the last line of the traceback, which repeats f"{etype}: {evalue}".
        frames = stb[2:-1]

        # Replace file links in each frame's header with an OSC8 link to the file and line number.
        new_frames = []
        for frame in frames:
            lines = frame.split("\n")
            # Add an OSC8 hyperlink to the frame header.
            lines[0] = _traceback_file_link_re.sub(_add_osc8_link, lines[0])
            new_frames.append("\n".join(lines))

        # Pop the first stack trace into evalue, so that it shows above the "Show Traceback" button
        # in the Positron Console.
        first_frame = new_frames.pop(0) if new_frames else ""
        evalue_str = f"{evalue}\n{first_frame}"

        # The parent implementation actually expects evalue to be an Exception instance, but
        # eventually calls str() on it. We're short-circuiting that by passing a string directly.
        # It works for now but might not in future.
        return super()._showtraceback(etype, evalue_str, new_frames)  # type: ignore IPython type annotation is wrong
