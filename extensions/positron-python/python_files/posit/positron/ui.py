#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import contextlib
import inspect
import logging
import os
import sys
import webbrowser
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Dict, List, Optional, Union
from urllib.parse import urlparse

from io import StringIO
from contextlib import redirect_stdout, redirect_stderr

from comm.base_comm import BaseComm

from ._vendor.pydantic import BaseModel
from .positron_comm import CommMessage, PositronComm
from .ui_comm import (
    CallMethodParams,
    CallMethodRequest,
    OpenEditorParams,
    ShowHtmlFileParams,
    ShowUrlParams,
    UiBackendMessageContent,
    UiFrontendEvent,
    WorkingDirectoryParams,
)
from .utils import JsonData, JsonRecord, alias_home, is_local_html_file

if TYPE_CHECKING:
    from .positron_ipkernel import PositronIPyKernel

logger = logging.getLogger(__name__)

_localhosts = [
    "localhost",
    "127.0.0.1",
    "[0:0:0:0:0:0:0:1]",
    "[::1]",
    "0.0.0.0",
    "[0:0:0:0:0:0:0:0]",
    "[::]",
]


#
# RPC methods called from the frontend.
#


class _InvalidParamsError(Exception):
    pass


def _is_module_loaded(kernel: "PositronIPyKernel", params: List[JsonData]) -> bool:
    if not (isinstance(params, list) and len(params) == 1 and isinstance(params[0], str)):
        raise _InvalidParamsError(f"Expected a module name, got: {params}")
    # Consider: this is not a perfect check for a couple of reasons:
    # 1. The module could be loaded under a different name
    # 2. The user may have a variable with the same name as the module
    return params[0] in kernel.shell.user_ns


def _set_console_width(_kernel: "PositronIPyKernel", params: List[JsonData]) -> None:
    if not (isinstance(params, list) and len(params) == 1 and isinstance(params[0], int)):
        raise _InvalidParamsError(f"Expected an integer width, got: {params}")

    width = params[0]

    # Set the COLUMNS variable to alter the value returned by shutil.get_terminal_size.
    # For example, pandas uses this (if set) to automatically determine display.max_columns.
    os.environ["COLUMNS"] = str(width)

    # Library-specific options:

    if "numpy" in sys.modules:
        import numpy as np

        np.set_printoptions(linewidth=width)

    if "pandas" in sys.modules:
        import pandas as pd

        # Set display.width to None so that pandas auto-detects the
        # correct value given the terminal width configured via the
        # COLUMNS variable above.  See:
        # https://pandas.pydata.org/docs/user_guide/options.html
        pd.set_option("display.width", None)

    if "polars" in sys.modules:
        import polars as pl

        pl.Config.set_tbl_width_chars(width)

    if "torch" in sys.modules:
        import torch

        torch.set_printoptions(linewidth=width)

def _evaluate(kernel: "PositronIPyKernel", params: List[JsonData]):
    if not (isinstance(params, list) and len(params) == 1 and isinstance(params[0], str)):
        raise _InvalidParamsError(f"Expected code as a string, got: {params}")

    stdout_buffer = StringIO()
    stderr_buffer = StringIO()

    try:
        with redirect_stdout(stdout_buffer), redirect_stderr(stderr_buffer):
            exec(params[0] + '\n\nprint(_)\n', kernel.shell.user_global_ns, kernel.shell.user_ns)
        return {
            'stdout': stdout_buffer.getvalue(),
            'stderr': stderr_buffer.getvalue()
        }
    except Exception as e:
        return {
            'stdout': stdout_buffer.getvalue(),
            'stderr': str(e),
        }

_RPC_METHODS: Dict[str, Callable[["PositronIPyKernel", List[JsonData]], Optional[JsonData]]] = {
    "setConsoleWidth": _set_console_width,
    "isModuleLoaded": _is_module_loaded,
    "evaluate": _evaluate,
}


class UiService:
    """
    Wrapper around a comm channel whose lifetime matches that of the Positron frontend.

    Used for communication with the frontend, unscoped to any particular view.
    """

    def __init__(self, kernel: "PositronIPyKernel") -> None:
        self.kernel = kernel

        self._comm: Optional[PositronComm] = None

        self._working_directory: Optional[Path] = None

    def on_comm_open(self, comm: BaseComm, _msg: JsonRecord) -> None:
        self._comm = PositronComm(comm)
        self._comm.on_msg(self.handle_msg, UiBackendMessageContent)

        self.browser = PositronViewerBrowser(comm=self._comm)
        webbrowser.register(
            self.browser.name,
            PositronViewerBrowser,
            self.browser,
            preferred=True,
        )

        # Clear the current working directory to generate an event for the new
        # client (i.e. after a reconnect)
        self._working_directory = None
        try:
            self.poll_working_directory()
        except Exception:
            logger.exception("Error polling working directory")

    def poll_working_directory(self) -> None:
        """
        Polls for changes to the working directory.

        And sends an event to the front end if the working directory has changed.
        """
        # Get the current working directory
        current_dir = Path.cwd()

        # If it isn't the same as the last working directory, send an event
        if current_dir != self._working_directory:
            self._working_directory = current_dir
            # Deliver event to client
            if self._comm is not None:
                event = WorkingDirectoryParams(directory=str(alias_home(current_dir)))
                self._send_event(name=UiFrontendEvent.WorkingDirectory, payload=event)

    def open_editor(self, file: str, line: int, column: int) -> None:
        event = OpenEditorParams(file=file, line=line, column=column)
        self._send_event(name=UiFrontendEvent.OpenEditor, payload=event)

    def clear_console(self) -> None:
        self._send_event(name=UiFrontendEvent.ClearConsole, payload={})

    def clear_webview_preloads(self) -> None:
        self._send_event(name=UiFrontendEvent.ClearWebviewPreloads, payload={})

    def handle_msg(self, msg: CommMessage[UiBackendMessageContent], _raw_msg: JsonRecord) -> None:
        request = msg.content.data

        if isinstance(request, CallMethodRequest):
            # Unwrap nested JSON-RPC
            self._call_method(request.params)

        else:
            logger.warning(f"Unhandled request: {request}")

    def _call_method(self, rpc_request: CallMethodParams) -> None:
        func = _RPC_METHODS.get(rpc_request.method, None)
        if func is None:
            return logger.warning(f"Invalid frontend RPC request method: {rpc_request.method}")

        try:
            result = func(self.kernel, rpc_request.params)
        except _InvalidParamsError as exception:
            return logger.warning(
                f"Invalid frontend RPC request params for method '{rpc_request.method}'. {exception}"
            )

        if self._comm is not None:
            self._comm.send_result(data=result)
            return None
        return None

    def shutdown(self) -> None:
        if self._comm is not None:
            with contextlib.suppress(Exception):
                self._comm.close()

    def _send_event(self, name: str, payload: Union[BaseModel, JsonRecord]) -> None:
        if self._comm is not None:
            if isinstance(payload, BaseModel):
                payload = payload.dict()
            self._comm.send_event(name=name, payload=payload)


class PositronViewerBrowser(webbrowser.BaseBrowser):
    """Launcher class for Positron Viewer browsers."""

    def __init__(
        self,
        name: str = "positron_viewer",
        comm: Optional[PositronComm] = None,
    ):
        self.name = name
        self._comm = comm

    def open(self, url, new=0, autoraise=True) -> bool:  # noqa: ARG002, FBT002
        if not self._comm:
            return False

        is_plot = False
        # If url is pointing to an HTML file, route to the ShowHtmlFile comm
        if is_local_html_file(url):
            # Send bokeh plots to the plots pane.
            # Identify bokeh plots by checking the stack for the bokeh.io.showing.show function.
            # This is not great but currently the only information we have.
            is_plot = self._is_module_function("bokeh.io.showing", "show")

            return self._send_show_html_event(url, is_plot)

        for addr in _localhosts:
            if addr in url:
                is_plot = self._is_module_function("plotly.basedatatypes")
                if is_plot:
                    return self._send_show_html_event(url, is_plot)
                else:
                    event = ShowUrlParams(url=url)
                    self._comm.send_event(name=UiFrontendEvent.ShowUrl, payload=event.dict())

                return True
        # pass back to webbrowser's list of browsers to open up the link
        return False

    @staticmethod
    def _is_module_function(module_name: str, function_name: Union[str, None] = None) -> bool:
        module = sys.modules.get(module_name)
        if module:
            for frame_info in inspect.stack():
                if function_name:
                    if (
                        inspect.getmodule(frame_info.frame, frame_info.filename) == module
                        and frame_info.function == function_name
                    ):
                        return True
                else:
                    if inspect.getmodule(frame_info.frame) == module:
                        return True
        return False

    def _send_show_html_event(self, url: str, is_plot: bool) -> bool:  # noqa: FBT001
        if self._comm is None:
            logger.warning("No comm available to send ShowHtmlFile event")
            return False
        if os.name == "nt":
            url = urlparse(url).netloc or urlparse(url).path
        self._comm.send_event(
            name=UiFrontendEvent.ShowHtmlFile,
            payload=ShowHtmlFileParams(
                path=url,
                # Use the URL's title.
                title="",
                is_plot=is_plot,
                # No particular height is required.
                height=0,
            ).dict(),
        )
        return True
