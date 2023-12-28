#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import logging
import os
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from comm.base_comm import BaseComm

from .frontend_comm import (
    CallMethodRequest,
    FrontendEvent,
    OpenEditorParams,
    WorkingDirectoryParams,
)
from .positron_comm import PositronComm
from .third_party import np_, pd_, pl_, torch_
from .utils import JsonData, alias_home

logger = logging.getLogger(__name__)


#
# RPC methods called from the frontend.
#


class _InvalidParamsError(Exception):
    pass


def _set_console_width(params: List[JsonData]) -> None:
    if not (isinstance(params, list) and len(params) == 1 and isinstance(params[0], int)):
        raise _InvalidParamsError()

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


class FrontendService:
    """
    Wrapper around a comm channel whose lifetime matches that of the Positron frontend.
    Used for communication with the frontend, unscoped to any particular view.
    """

    def __init__(self) -> None:
        self._comm: Optional[PositronComm] = None

        self._working_directory: Optional[Path] = None

    def on_comm_open(self, comm: BaseComm, msg: Dict[str, JsonData]) -> None:
        self._comm = PositronComm(comm)
        comm.on_msg(self._receive_message)

        # Clear the current working directory to generate an event for the new
        # client (i.e. after a reconnect)
        self._working_directory = None
        try:
            self.poll_working_directory()
        except:
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
                self._send_event(name=FrontendEvent.WorkingDirectory, payload=event)

    def open_editor(self, file: str, line: int, column: int) -> None:
        if self._comm is not None:
            event = OpenEditorParams(file=file, line=line, column=column)
            self._comm.send_event(name=FrontendEvent.OpenEditor, payload=asdict(event))

    def _receive_message(self, msg: Dict[str, Any]) -> None:
        data = msg["content"]["data"]

        try:
            rpc_request = CallMethodRequest(**data)
        except TypeError:
            return logger.exception(f"Invalid frontend RPC request: {data}")

        # Unwrap nested JSON-RPC
        rpc_request = rpc_request.params

        func = _RPC_METHODS.get(rpc_request.method, None)
        if func is None:
            return logger.warning(f"Invalid frontend RPC request method: {rpc_request.method}")

        try:
            result = func(rpc_request.params)
        except _InvalidParamsError:
            return logger.warning(
                f"Invalid frontend RPC request params for method '{rpc_request.method}': {rpc_request.params}"
            )

        if self._comm is not None:
            self._comm.send_result(data=result)

    def shutdown(self) -> None:
        if self._comm is not None:
            try:
                self._comm.close()
            except Exception:
                pass

    def _send_event(self, name: str, payload: Any) -> None:
        if self._comm is not None:
            self._comm.send_event(name=name, payload=asdict(payload))
