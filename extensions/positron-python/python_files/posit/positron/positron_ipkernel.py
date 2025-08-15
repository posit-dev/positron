#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""Positron extensions to the iPython Kernel."""

from __future__ import annotations

import enum
import logging
import os
import re
import warnings
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Container, cast

import psutil
import traitlets
from ipykernel.compiler import get_tmp_directory
from ipykernel.debugger import _is_debugpy_available
from ipykernel.ipkernel import IPythonKernel
from ipykernel.kernelapp import IPKernelApp
from ipykernel.zmqshell import ZMQDisplayPublisher, ZMQInteractiveShell
from IPython.core import magic_arguments, oinspect, page
from IPython.core.error import UsageError
from IPython.core.formatters import DisplayFormatter, IPythonDisplayFormatter, catch_format_error
from IPython.core.interactiveshell import ExecutionInfo, ExecutionResult, InteractiveShell
from IPython.core.magic import Magics, MagicsManager, line_magic, magics_class
from IPython.utils import PyColorize

from .access_keys import encode_access_key
from .connections import ConnectionsService
from .data_explorer import DataExplorerService, DataExplorerWarning
from .debugger import PositronDebugger
from .help import HelpService, help  # noqa: A004
from .lsp import LSPService
from .patch.bokeh import handle_bokeh_output, patch_bokeh_no_access
from .patch.haystack import patch_haystack_is_in_jupyter
from .patch.holoviews import set_holoviews_extension
from .plots import PlotsService
from .session_mode import SessionMode
from .ui import UiService
from .utils import BackgroundJobQueue, JsonRecord, get_qualname, with_logging
from .variables import VariablesService

if TYPE_CHECKING:
    from ipykernel.comm.manager import CommManager
    from ipykernel.control import ControlThread


class _CommTarget(str, enum.Enum):
    DataExplorer = "positron.dataExplorer"
    Ui = "positron.ui"
    Help = "positron.help"
    Lsp = "positron.lsp"
    Plot = "positron.plot"
    Variables = "positron.variables"
    Widget = "jupyter.widget"
    Connections = "positron.connection"


logger = logging.getLogger(__name__)


class PositronIPythonInspector(oinspect.Inspector):
    parent: PositronShell

    def pinfo(
        self,
        obj: Any,
        oname: str = "",
        formatter: Callable[[str], dict[str, str]] | None = None,
        info: oinspect.OInfo | None = None,
        detail_level: int = 0,
        enable_html_pager: bool = True,  # noqa: FBT001, FBT002
        omit_sections: Container[str] = (),
    ) -> None:
        kernel = self.parent.kernel

        # Intercept `%pinfo obj` / `obj?` calls, and instead use Positron's help service
        if detail_level == 0:
            kernel.help_service.show_help(obj)
            return None

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
        return None

    pinfo.__doc__ = oinspect.Inspector.pinfo.__doc__


@magics_class
class PositronMagics(Magics):
    shell: PositronShell

    # This will override the default `clear` defined in `ipykernel.zmqshell.KernelMagics`.
    @line_magic
    def clear(self, line: str) -> None:  # noqa: ARG002
        """Clear the console."""
        # Send a message to the frontend to clear the console.
        self.shell.kernel.ui_service.clear_console()

    @magic_arguments.magic_arguments()
    @magic_arguments.argument(
        "object",
        help="The object or expression to view.",
    )
    @magic_arguments.argument(
        "title",
        nargs="?",
        help="The title of the Data Explorer tab. Defaults to the object's name or expression.",
    )
    @line_magic
    def view(self, line: str) -> None:
        """
        View an object or expression result in the Positron Data Explorer.

        Examples
        --------
        View an object:

        >>> %view df

        View an expression result:

        >>> %view df.groupby('column').sum()

        View an object with a custom title (quotes are required if the title contains spaces):

        >>> %view df "My Dataset"
        """
        try:
            args = magic_arguments.parse_argstring(self.view, line)
        except UsageError as e:
            if (
                len(e.args) > 0
                and isinstance(e.args[0], str)
                and e.args[0].startswith("unrecognized arguments")
            ):
                raise UsageError(f"{e.args[0]}. Did you quote the title?") from e
            raise

        # First try to find the object directly by name
        info = self.shell._ofind(args.object)  # noqa: SLF001

        if info.found:
            obj = info.obj
        else:
            # Check if the object name is a quoted string and remove quotes if necessary
            obj_name = args.object
            if (obj_name.startswith('"') and obj_name.endswith('"')) or (
                obj_name.startswith("'") and obj_name.endswith("'")
            ):
                obj_name = obj_name[1:-1]  # Remove the quotes

            # If not found as a variable, try to evaluate it as an expression
            try:
                obj = self.shell.ev(obj_name)
            except Exception as e:
                raise UsageError(f"Failed to evaluate expression '{obj_name}': %s" % e) from e

        title = args.title
        if title is None:
            title = args.object
        else:
            # Remove quotes around the title if they exist.
            if (title.startswith('"') and title.endswith('"')) or (
                title.startswith("'") and title.endswith("'")
            ):
                title = title[1:-1]

        # Register a dataset with the data explorer service.
        try:
            self.shell.kernel.data_explorer_service.register_table(
                obj, title, variable_path=[encode_access_key(args.object)]
            )
        except TypeError as e:
            raise UsageError(f"cannot view object of type '{get_qualname(obj)}'") from e

    @magic_arguments.magic_arguments()
    @magic_arguments.argument(
        "object",
        help="The connection object to show.",
    )
    @line_magic
    def connection_show(self, line: str) -> None:
        """Show a connection object in the Positron Connections Pane."""
        args = magic_arguments.parse_argstring(self.connection_show, line)

        # Find the object.
        info = self.shell._ofind(args.object)  # noqa: SLF001
        if not info.found:
            raise UsageError(f"name '{args.object}' is not defined")

        try:
            self.shell.kernel.connections_service.register_connection(
                info.obj, variable_path=args.object
            )
        except TypeError as e:
            raise UsageError(f"cannot show object of type '{get_qualname(info.obj)}'") from e


_traceback_file_link_re = re.compile(r"^(File \x1b\[\d+;\d+m)(.+):(\d+)")

# keep reference to original showwarning
original_showwarning = warnings.showwarning


class PositronDisplayFormatter(DisplayFormatter):
    @traitlets.default("ipython_display_formatter")
    def _default_formatter(self):
        return PositronIPythonDisplayFormatter(parent=self)


class PositronIPythonDisplayFormatter(IPythonDisplayFormatter):
    print_method = traitlets.ObjectName("_ipython_display_")
    _return_type = (type(None), bool)

    @catch_format_error
    def __call__(self, obj):
        """Compute the format for an object."""
        try:
            if obj.__module__ == "plotnine.ggplot":
                obj.draw(show=True)
                return True
        except AttributeError:
            pass
        return super().__call__(obj)


class PositronShell(ZMQInteractiveShell):
    kernel: PositronIPyKernel
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
        parent = cast("PositronIPyKernel", kwargs["parent"])
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


def _add_osc8_link(match: re.Match) -> str:
    """Convert a link matched by `_traceback_file_link_re` to an OSC8 link."""
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
        PositronShell,  # type: ignore
        klass=InteractiveShell,
    )

    # Positron-specific attributes:
    session_mode: SessionMode = SessionMode.trait()  # type: ignore

    def __init__(self, **kwargs) -> None:
        # Set custom attributes from the parent object.
        # It would be better to pass these as explicit arguments, but there's no easy way
        # to override the parent to do that.
        parent = cast("PositronIPKernelApp", kwargs["parent"])
        self.session_mode = parent.session_mode

        super().__init__(**kwargs)

        # Override the Debugger
        if _is_debugpy_available:
            self.debugger = PositronDebugger(
                self.log,
                self.debugpy_stream,
                self._publish_debug_event,
                self.debug_shell_socket,
                self.session,
                self.debug_just_my_code,
            )

        self.job_queue = BackgroundJobQueue()

        # Create Positron services
        self.data_explorer_service = DataExplorerService(_CommTarget.DataExplorer, self.job_queue)
        self.plots_service = PlotsService(_CommTarget.Plot, self.session_mode)
        self.ui_service = UiService(self)
        self.help_service = HelpService()
        self.lsp_service = LSPService(self)
        self.variables_service = VariablesService(self)
        self.connections_service = ConnectionsService(self, _CommTarget.Connections)

        # Register comm targets
        self.comm_manager.register_target(_CommTarget.Lsp, self.lsp_service.on_comm_open)
        self.comm_manager.register_target(_CommTarget.Ui, self.ui_service.on_comm_open)
        self.comm_manager.register_target(_CommTarget.Help, self.help_service.on_comm_open)
        self.comm_manager.register_target(
            _CommTarget.Variables, self.variables_service.on_comm_open
        )

        warnings.showwarning = self._showwarning
        self._show_dataexplorer_warning = True

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

        # Patch holoviews to use our custom notebook extension.
        set_holoviews_extension(self.ui_service)
        handle_bokeh_output(self.session_mode)

        # Patch bokeh to generate html in tempfile
        patch_bokeh_no_access()

        # Patch haystack-ai to ensure is_in_jupyter() returns True in Positron
        patch_haystack_is_in_jupyter()

    @property
    def kernel_info(self):
        kernel_info = super().kernel_info

        # 'supported_features' is only added in ipykernel 7.0.0, but we backport it to older versions
        # since it's used by Positron to detect debugger support.
        if "supported_features" not in kernel_info:
            kernel_info["supported_features"] = []
            if _is_debugpy_available:
                # If debugpy is available, add the 'debugger' feature.
                kernel_info["supported_features"].append("debugger")

        return kernel_info

    def publish_execute_input(
        self,
        code: str,
        parent: JsonRecord,
    ) -> None:
        self._publish_execute_input(code, parent, self.execution_count - 1)

    def start(self) -> None:
        super().start()

        # Start Positron services
        self.help_service.start()

    async def do_shutdown(self, restart: bool) -> JsonRecord:  # type: ignore ReportIncompatibleMethodOverride  # noqa: FBT001
        """Handle kernel shutdown."""
        logger.info("Shutting down the kernel")

        # Shut down thread pool for background job queue
        self.job_queue.shutdown()

        # Shutdown Positron services
        self.data_explorer_service.shutdown()
        self.ui_service.shutdown()
        self.help_service.shutdown()
        self.lsp_service.shutdown()
        self.plots_service.shutdown()
        await self.variables_service.shutdown()
        self.connections_service.shutdown()

        # We don't call super().do_shutdown since it sets shell.exit_now = True which tries to
        # stop the event loop at the same time as self.shutdown_request (since self.shell_stream.io_loop
        # points to the same underlying asyncio loop).
        return {"status": "ok", "restart": restart}

    def _signal_children(self, signum: int) -> None:
        super()._signal_children(signum)

        # Reap zombie processes.
        # See https://github.com/posit-dev/positron/issues/3344
        children: list[psutil.Process] = self._process_children()
        for child in children:
            if child.status() == psutil.STATUS_ZOMBIE:
                self.log.debug("Reaping zombie subprocess %s", child)
                try:
                    # Non-blocking wait since timeout is 0. If the process is still alive, it'll
                    # raise a TimeoutExpired.
                    child.wait(timeout=0)
                except psutil.TimeoutExpired as exception:
                    self.log.warning(
                        "Error while reaping zombie subprocess %s: %s",
                        child,
                        exception,
                    )

    # monkey patching warning.showwarning is recommended by the official documentation
    # https://docs.python.org/3/library/warnings.html#warnings.showwarning
    def _showwarning(self, message, category, filename, lineno, file=None, line=None):
        # if coming from one of our files, log and don't send to user
        positron_files_path = Path(__file__).parent

        # Check if the filename refers to a cell in the Positron Console.
        # We use the fact that ipykernel sets the filename to a path starting in the root temporary
        # directory. We can't determine the full filename since it depends on the cell's code which
        # is unknown at this point. See ipykernel.compiler.XCachingCompiler.get_code_name.
        console_dir = get_tmp_directory()
        if console_dir in str(filename):
            filename = f"<positron-console-cell-{self.execution_count}>"

        # switch to only show the "numpy not installed" data explorer warning only once
        if isinstance(message, DataExplorerWarning):
            if not self._show_dataexplorer_warning:
                return None
            else:
                self._show_dataexplorer_warning = False

        # unless it is a DataExplorerImportWarning (which we want to show)
        # send to logs if warning is coming from Positron files
        # also send warnings from attempted compiles from IPython to logs
        # https://github.com/ipython/ipython/blob/8.24.0/IPython/core/async_helpers.py#L151
        if (str(positron_files_path) in str(filename) or str(filename) == "<>") and not isinstance(
            message, DataExplorerWarning
        ):
            msg = f"{filename}-{lineno}: {category}: {message}"
            logger.warning(msg)
            return None

        msg = warnings.WarningMessage(message, category, filename, lineno, file, line)  # type: ignore

        return original_showwarning(message, category, filename, lineno, file, line)  # type: ignore reportAttributeAccessIssue


class PositronIPKernelApp(IPKernelApp):
    control_thread: ControlThread | None
    kernel: PositronIPyKernel

    # Use the PositronIPyKernel class.
    kernel_class: type[PositronIPyKernel] = traitlets.Type(PositronIPyKernel)  # type: ignore

    # Positron-specific attributes:
    session_mode: SessionMode = SessionMode.trait()  # type: ignore

    def init_control(self, context):
        result = super().init_control(context)
        # Should be defined in init_control().
        assert self.control_thread is not None
        # Add a bunch of debug logging to control thread methods.
        # See: https://github.com/posit-dev/positron/issues/7142.
        self.control_thread.io_loop.start = with_logging(self.control_thread.io_loop.start)
        self.control_thread.io_loop.stop = with_logging(self.control_thread.io_loop.stop)
        self.control_thread.io_loop.close = with_logging(self.control_thread.io_loop.close)
        self.control_thread.run = with_logging(self.control_thread.run)
        self.control_thread.stop = with_logging(self.control_thread.stop)
        self.control_thread.join = with_logging(self.control_thread.join)
        return result

    def init_gui_pylab(self):
        # Enable the Positron matplotlib backend if we're not in a notebook.
        # If we're in a notebook, use IPython's default backend via the super() call below.
        # Matplotlib uses the MPLBACKEND environment variable to determine the backend to use.
        # It imports the backend module when it's first needed.
        if self.session_mode != SessionMode.NOTEBOOK and not os.environ.get("MPLBACKEND"):
            os.environ["MPLBACKEND"] = "module://positron.matplotlib_backend"

        return super().init_gui_pylab()

    def close(self):
        # Stop the control thread if it's still alive. This is also attempted in super().close(),
        # but that doesn't timeout on join() so can hang forever if the control thread is stuck.
        # See https://github.com/posit-dev/positron/issues/7142.
        if self.control_thread and self.control_thread.is_alive():
            self.log.debug("Closing control thread")
            self.control_thread.stop()
            self.control_thread.join(timeout=5)
            # If the thread is still alive after 5 seconds, log a warning and drop the reference.
            # This leaves the thread dangling, but since it's a daemon thread it won't stop the
            # process from exiting.
            if self.control_thread.is_alive() and self.control_thread.daemon:
                self.log.warning("Control thread did not exit after 5 seconds, dropping it")
                self.control_thread = None

        super().close()


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


def _start_hyperlink(uri: str = "", params: dict[str, str] | None = None) -> str:
    """Start sequence for a hyperlink."""
    if params is None:
        params = {}
    params_str = ":".join(f"{key}={value}" for key, value in params.items())
    return f"{_OSC8};{params_str};{uri}" + _ST


def _end_hyperlink() -> str:
    """End sequence for a hyperlink."""
    return _start_hyperlink()


def _link(uri: str, label: str, params: dict[str, str] | None = None) -> str:
    """Create a hyperlink with the given label, URI, and params."""
    if params is None:
        params = {}
    return _start_hyperlink(uri, params) + label + _end_hyperlink()
