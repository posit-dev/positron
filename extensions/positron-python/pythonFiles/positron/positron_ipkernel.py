#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

""" Positron extensions to the iPython Kernel."""
from __future__ import annotations

import enum
import logging
import re
import warnings
from pathlib import Path
from typing import Any, Callable, Container, Dict, List, Optional, Type

import traitlets
from ipykernel.comm.manager import CommManager
from ipykernel.ipkernel import IPythonKernel
from ipykernel.kernelapp import IPKernelApp
from ipykernel.zmqshell import ZMQDisplayPublisher, ZMQInteractiveShell
from IPython.core import oinspect, page
from IPython.core.interactiveshell import InteractiveShell
from IPython.core.magic import (
    Magics,
    MagicsManager,
    line_magic,
    magics_class,
    needs_local_scope,
)
from IPython.utils import PyColorize

from positron.data_tool import DataToolService

from .dataviewer import DataViewerService
from .ui import UiService
from .help import HelpService, help
from .lsp import LSPService
from .plots import PositronDisplayPublisherHook
from .utils import JsonData
from .variables import VariablesService
from .widget import PositronWidgetHook


class _CommTarget(str, enum.Enum):
    DataViewer = "positron.dataViewer"
    DataTool = "positron.dataTool"
    Ui = "positron.ui"
    Help = "positron.help"
    Lsp = "positron.lsp"
    Plot = "positron.plot"
    Variables = "positron.variables"
    Widget = "jupyter.widget"


logger = logging.getLogger(__name__)


class PositronIPythonInspector(oinspect.Inspector):
    parent: PositronShell

    def pinfo(
        self,
        obj: Any,
        oname: str = "",
        formatter: Optional[Callable[[str], Dict[str, str]]] = None,
        info: Optional[oinspect.OInfo] = None,
        detail_level: int = 0,
        enable_html_pager: bool = True,
        omit_sections: Container[str] = (),
    ) -> None:
        kernel = self.parent.kernel

        # Intercept `%pinfo obj` / `obj?` calls, and instead use Positron's help service
        if detail_level == 0:
            kernel.help_service.show_help(obj)
            return

        # For `%pinfo2 obj` / `obj??` calls, try to open an editor via Positron's UI service
        fname = oinspect.find_file(obj)

        if fname is None:
            # If we couldn't get a filename, fall back to the default implementation.
            return super().pinfo(
                obj,
                oname,
                formatter,
                info,
                detail_level,
                enable_html_pager,
                omit_sections,
            )

        # If we got a filename, try to get the line number and open an editor.
        lineno = oinspect.find_source_lines(obj) or 0
        kernel.ui_service.open_editor(fname, lineno, 0)

    pinfo.__doc__ = oinspect.Inspector.pinfo.__doc__


@magics_class
class PositronMagics(Magics):
    shell: PositronShell

    @line_magic
    def clear(self, line: str) -> None:  # type: ignore reportIncompatibleMethodOverride
        """Clear the console."""
        # Send a message to the frontend to clear the console.
        self.shell.kernel.ui_service.clear_console()

    @needs_local_scope
    @line_magic
    def view(self, line: str, local_ns: Dict[str, Any]):
        """View an object in the Positron Data Tool."""
        try:
            obj = local_ns[line]
        except KeyError:  # not in namespace
            obj = eval(line, local_ns, local_ns)

        # Register a dataset with the dataviewer service.
        self.shell.kernel.datatool_service.register_table(obj, line)


_traceback_file_link_re = re.compile(r"^(File \x1b\[\d+;\d+m)(.+):(\d+)")


class PositronShell(ZMQInteractiveShell):
    kernel: PositronIPyKernel
    object_info_string_level: int
    magics_manager: MagicsManager
    display_pub: ZMQDisplayPublisher

    inspector_class: Type[PositronIPythonInspector] = traitlets.Type(
        PositronIPythonInspector,
        help="Class to use to instantiate the shell inspector",  # type: ignore
    ).tag(config=True)

    def init_events(self) -> None:
        super().init_events()

        # Register event handlers to poll the user's environment before and after each execution.
        self.events.register("pre_execute", self._handle_pre_execute)
        self.events.register("post_execute", self._handle_post_execute)

    @traitlets.observe("colors")
    def init_inspector(self, changes: Optional[traitlets.Bunch] = None) -> None:
        # Override to pass `parent=self` to the inspector so that the inspector can send messages
        # over the kernel's comms.
        self.inspector = self.inspector_class(
            oinspect.InspectColors,
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

    def _handle_pre_execute(self) -> None:
        """
        Prior to execution, reset the user environment watch state.
        """
        try:
            self.kernel.variables_service.snapshot_user_ns()
        except Exception:
            logger.warning("Failed to snapshot user namespace", exc_info=True)

    def _handle_post_execute(self) -> None:
        """
        After execution, sends an update message to the client to summarize
        the changes observed to variables in the user's environment.
        """
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

    @traitlets.observe("exit_now")
    def _update_exit_now(self, change):
        """stop eventloop when exit_now fires"""
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

    def _showtraceback(self, etype, evalue: Exception, stb: List[str]):  # type: ignore IPython type annotation is wrong
        """
        Enhance tracebacks for the Positron frontend.
        """
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


def _add_osc8_link(match: re.Match) -> str:
    """
    Convert a link matched by `_traceback_file_link_re` to an OSC8 link.
    """
    pre, path, line = match.groups()
    abs_path = Path(path).expanduser()
    try:
        uri = abs_path.as_uri()
    except ValueError:
        # The path might be like '<ipython-...>' which raises a ValueError on as_uri().
        return match.group(0)
    return pre + _link(uri, f"{path}:{line}", {"line": line})


class PositronIPyKernel(IPythonKernel):
    """
    Positron extension of IPythonKernel.

    Adds additional comms to introspect the user's environment.
    """

    execution_count: int  # type: ignore reportIncompatibleMethodOverride
    shell: PositronShell
    comm_manager: CommManager

    # Use the PositronShell class.
    shell_class: PositronShell = traitlets.Type(
        PositronShell, klass=InteractiveShell
    )  # type: ignore

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)

        # Create Positron services
        self.dataviewer_service = DataViewerService(_CommTarget.DataViewer)
        self.datatool_service = DataToolService(_CommTarget.DataTool)
        self.display_pub_hook = PositronDisplayPublisherHook(_CommTarget.Plot)
        self.ui_service = UiService()
        self.help_service = HelpService()
        self.lsp_service = LSPService(self)
        self.variables_service = VariablesService(self)
        self.widget_hook = PositronWidgetHook(_CommTarget.Widget, self.comm_manager)

        # Register comm targets
        self.comm_manager.register_target(_CommTarget.Lsp, self.lsp_service.on_comm_open)
        self.comm_manager.register_target(_CommTarget.Ui, self.ui_service.on_comm_open)
        self.comm_manager.register_target(_CommTarget.Help, self.help_service.on_comm_open)
        self.comm_manager.register_target(
            _CommTarget.Variables, self.variables_service.on_comm_open
        )
        # Register display publisher hooks
        self.shell.display_pub.register_hook(self.display_pub_hook)
        self.shell.display_pub.register_hook(self.widget_hook)

        # Ignore warnings that the user can't do anything about
        warnings.filterwarnings(
            "ignore",
            category=UserWarning,
            message="Matplotlib is currently using module://matplotlib_inline.backend_inline",
        )
        # Trying to import a module that's "auto-imported" by Jedi shows a warning in the Positron
        # Console.
        warnings.filterwarnings(
            "ignore",
            category=UserWarning,
            message=r"Module [^\s]+ not importable in path",
            module="jedi",
        )

    def publish_execute_input(
        self,
        code: str,
        parent: Dict[str, JsonData],
    ) -> None:
        self._publish_execute_input(code, parent, self.execution_count - 1)

    def start(self) -> None:
        super().start()

        # Start Positron services
        self.help_service.start()

    async def do_shutdown(self, restart: bool) -> Dict[str, JsonData]:  # type: ignore ReportIncompatibleMethodOverride
        """
        Handle kernel shutdown.
        """
        logger.info("Shutting down the kernel")

        # Shutdown Positron services
        self.dataviewer_service.shutdown()
        self.datatool_service.shutdown()
        self.display_pub_hook.shutdown()
        self.ui_service.shutdown()
        self.help_service.shutdown()
        self.lsp_service.shutdown()
        self.widget_hook.shutdown()
        await self.variables_service.shutdown()

        # We don't call super().do_shutdown since it sets shell.exit_now = True which tries to
        # stop the event loop at the same time as self.shutdown_request (since self.shell_stream.io_loop
        # points to the same underlying asyncio loop).
        return dict(status="ok", restart=restart)


class PositronIPKernelApp(IPKernelApp):
    # Use the PositronIPyKernel class.
    kernel_class: Type[PositronIPyKernel] = traitlets.Type(PositronIPyKernel)  # type: ignore


#
# OSC8 functionality
#
# See https://iterm2.com/3.2/documentation-escape-codes.html for a description.
#

# Define a few OSC8 excape codes for convenience.
_ESC = "\x1b"
_OSC = _ESC + "]"
_OSC8 = _OSC + "8"
_ST = _ESC + "\\"


def _start_hyperlink(uri: str = "", params: Dict[str, str] = {}) -> str:
    """
    Start sequence for a hyperlink.
    """
    params_str = ":".join(f"{key}={value}" for key, value in params.items())
    return ";".join([_OSC8, params_str, uri]) + _ST


def _end_hyperlink() -> str:
    """
    End sequence for a hyperlink.
    """
    return _start_hyperlink()


def _link(uri: str, label: str, params: Dict[str, str] = {}) -> str:
    """
    Create a hyperlink with the given label, URI, and params.
    """
    return _start_hyperlink(uri, params) + label + _end_hyperlink()
