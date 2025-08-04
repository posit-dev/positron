#
# Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import enum
import logging
import warnings
from pathlib import Path
from typing import TYPE_CHECKING, cast

import psutil
import traitlets
from ipykernel.compiler import get_tmp_directory
from ipykernel.ipkernel import IPythonKernel
from IPython.core.interactiveshell import InteractiveShell

from ..connections import ConnectionsService
from ..data_explorer import DataExplorerService, DataExplorerWarning
from ..help import HelpService
from ..lsp import LSPService
from ..patch.bokeh import handle_bokeh_output, patch_bokeh_no_access
from ..patch.haystack import patch_haystack_is_in_jupyter
from ..patch.holoviews import set_holoviews_extension
from ..plots import PlotsService
from ..ui import UiService
from ..utils import BackgroundJobQueue, JsonRecord
from ..variables import VariablesService
from .session_mode import SessionMode
from .shell import PositronShell

if TYPE_CHECKING:
    from ipykernel.comm.manager import CommManager

    from .kernelapp import PositronIPKernelApp

logger = logging.getLogger(__name__)

# keep reference to original showwarning
original_showwarning = warnings.showwarning


class CommName(str, enum.Enum):
    DataExplorer = "positron.dataExplorer"
    Ui = "positron.ui"
    Help = "positron.help"
    Lsp = "positron.lsp"
    Plot = "positron.plot"
    Variables = "positron.variables"
    Widget = "jupyter.widget"
    Connections = "positron.connection"


class PositronIPythonKernel(IPythonKernel):
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

        self.job_queue = BackgroundJobQueue()

        # Create Positron services
        self.data_explorer_service = DataExplorerService(CommName.DataExplorer, self.job_queue)
        self.plots_service = PlotsService(CommName.Plot, self.session_mode)
        self.ui_service = UiService(self)
        self.help_service = HelpService()
        self.lsp_service = LSPService(self)
        self.variables_service = VariablesService(self)
        self.connections_service = ConnectionsService(self, CommName.Connections)

        # Register comm targets
        self.comm_manager.register_target(CommName.Lsp, self.lsp_service.on_comm_open)
        self.comm_manager.register_target(CommName.Ui, self.ui_service.on_comm_open)
        self.comm_manager.register_target(CommName.Help, self.help_service.on_comm_open)
        self.comm_manager.register_target(CommName.Variables, self.variables_service.on_comm_open)

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

    def publish_execute_input(
        self,
        code: str,
        parent: JsonRecord,
    ) -> None:
        self._publish_execute_input(code, parent, self.execution_count - 1)

    async def do_debug_request(self, msg):
        return await super().do_debug_request(msg)

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
