#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import inspect
import logging
import os
import shutil
import sys
import webbrowser
from pathlib import Path
from typing import Callable, Dict, List, Optional, Union
from urllib.parse import urlparse

from comm.base_comm import BaseComm

from ._vendor.pydantic import BaseModel
from .positron_comm import CommMessage, PositronComm
from .third_party import np_, pd_, pl_, torch_
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


def _set_console_width(params: List[JsonData]) -> None:
    if not (isinstance(params, list) and len(params) == 1 and isinstance(params[0], int)):
        raise _InvalidParamsError(f"Expected an integer width, got: {params}")

    width = params[0]

    # Set the COLUMNS variable to alter the value returned by shutil.get_terminal_size.
    # For example, pandas uses this (if set) to automatically determine display.max_columns.
    os.environ["COLUMNS"] = str(width)

    # Library-specific options:

    if np_ is not None:
        np_.set_printoptions(linewidth=width)

    if pd_ is not None:
        # Set display.width to None so that pandas auto-detects the correct value given the
        # terminal width configured via the COLUMNS variable above.
        # See: https://pandas.pydata.org/docs/user_guide/options.html
        pd_.set_option("display.width", None)

    if pl_ is not None:
        pl_.Config.set_tbl_width_chars(width)

    if torch_ is not None:
        torch_.set_printoptions(linewidth=width)


_RPC_METHODS: Dict[str, Callable[[List[JsonData]], JsonData]] = {
    "setConsoleWidth": _set_console_width,
}


class UiService:
    """
    Wrapper around a comm channel whose lifetime matches that of the Positron frontend.
    Used for communication with the frontend, unscoped to any particular view.
    """

    def __init__(self) -> None:
        self._comm: Optional[PositronComm] = None

        self._working_directory: Optional[Path] = None

    def on_comm_open(self, comm: BaseComm, msg: JsonRecord) -> None:
        self._comm = PositronComm(comm)
        self._comm.on_msg(self.handle_msg, UiBackendMessageContent)

        self.browser = PositronViewerBrowser(comm=self._comm)
        webbrowser.register(self.browser.name, PositronViewerBrowser, self.browser, preferred=True)

        # Clear the current working directory to generate an event for the new
        # client (i.e. after a reconnect)
        self._working_directory = None
        try:
            self.poll_working_directory()
        except Exception:
            logger.exception("Error polling working directory")

    def poll_working_directory(self) -> None:
        """
        Polls for changes to the working directory, and sends an event to the
        front end if the working directory has changed.
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

    def load_holoviews_extension(self) -> None:
        self._send_event(name=UiFrontendEvent.LoadHoloviewsExtension, payload={})

    def handle_msg(self, msg: CommMessage[UiBackendMessageContent], raw_msg: JsonRecord) -> None:
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
            result = func(rpc_request.params)
        except _InvalidParamsError as exception:
            return logger.warning(
                f"Invalid frontend RPC request params for method '{rpc_request.method}'. {exception}"
            )

        if self._comm is not None:
            self._comm.send_result(data=result)

    def shutdown(self) -> None:
        if self._comm is not None:
            try:
                self._comm.close()
            except Exception:
                pass

    def _send_event(self, name: str, payload: Union[BaseModel, JsonRecord]) -> None:
        if self._comm is not None:
            if isinstance(payload, BaseModel):
                payload = payload.dict()
            self._comm.send_event(name=name, payload=payload)


class PositronViewerBrowser(webbrowser.BaseBrowser):
    """Launcher class for Positron Viewer browsers."""

    def __init__(self, name: str = "positron_viewer", comm: Optional[PositronComm] = None):
        self.name = name
        self._comm = comm

    def open(self, url, new=0, autoraise=True):
        if not self._comm:
            return False

        # If url is pointing to an HTML file, route to the ShowHtmlFile comm
        if is_local_html_file(url):
            is_plot = False

            # Send bokeh plots to the plots pane.
            # Identify bokeh plots by checking the stack for the bokeh.io.showing.show function.
            # This is not great but currently the only information we have.
            bokeh_io_showing = sys.modules.get("bokeh.io.showing")
            if bokeh_io_showing:
                for frame_info in inspect.stack():
                    if (
                        inspect.getmodule(frame_info.frame, frame_info.filename) == bokeh_io_showing
                        and frame_info.function == "show"
                    ):
                        is_plot = True
                        break

            filename = "plot.html"
            title = ""
            try:
                import bokeh

                bokeh_state = bokeh.io.state.curstate()
                filename = bokeh_state.file.filename
                title = bokeh_state.file.title
            # bokoeh not installed, or has no state
            except (ImportError, AttributeError):
                pass
            # get path to the python_files/positron dir
            parent = str(Path(__file__).parent.parent)

            # bug where os.access is True on Windows when there is no access
            # if the html file was not given a specific path, it will populate
            # inside the positron_python extension. instead, put it in the cwd
            if parent in url:
                new_url = Path.cwd().joinpath(filename)
                parsed = urlparse(url)
                shutil.move(url.removeprefix("file://"), new_url)
                url = str(Path(parsed.scheme).joinpath(new_url))

            self._comm.send_event(
                name=UiFrontendEvent.ShowHtmlFile,
                payload=ShowHtmlFileParams(
                    path=url,
                    # Use the HTML file's title.
                    title=title,
                    is_plot=is_plot,
                    # No particular height is required.
                    height=0,
                ).dict(),
            )
            return True

        for addr in _localhosts:
            if addr in url:
                event = ShowUrlParams(url=url)
                self._comm.send_event(name=UiFrontendEvent.ShowUrl, payload=event.dict())
                return True
        # pass back to webbrowser's list of browsers to open up the link
        return False
