#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

from __future__ import annotations

import logging
import pydoc
from dataclasses import asdict
from typing import TYPE_CHECKING, Any, Optional, Union

from .help_comm import HelpFrontendEvent, ShowHelpKind, ShowHelpParams, ShowHelpTopicRequest
from .positron_comm import JsonRpcErrorCode, PositronComm
from .pydoc import start_server
from .utils import get_qualname

if TYPE_CHECKING:
    from comm.base_comm import BaseComm

logger = logging.getLogger(__name__)


def help(topic="help"):
    """
    Show help for the given topic.

    Examples
    --------

    Show help for the `help` function itself:

    >>> help()

    Show help for a type:

    >>> import pandas
    >>> help(pandas.DataFrame)

    A string import path works too:

    >>> help("pandas.DataFrame")

    Show help for a type given an instance:

    >>> df = pandas.DataFrame()
    >>> help(df)
    """
    from .positron_ipkernel import PositronIPyKernel

    if PositronIPyKernel.initialized():
        kernel = PositronIPyKernel.instance()
        kernel.help_service.show_help(topic)
    else:
        raise Exception("Unexpected error. No PositronIPyKernel has been initialized.")


class HelpService:
    """
    Manages the help server and submits help-related events to the `FrontendService`.
    """

    # Not sure why, but some qualified names cause errors in pydoc. Manually replace these with
    # names that are known to work.
    _QUALNAME_OVERRIDES = {
        "pandas.core.frame": "pandas",
        "pandas.core.series": "pandas",
    }

    def __init__(self):
        self._comm: Optional[PositronComm] = None
        self._pydoc_thread = None

    def on_comm_open(self, comm: BaseComm, msg) -> None:
        self._comm = PositronComm(comm)
        comm.on_msg(self._receive_message)

    def _receive_message(self, msg) -> None:
        """
        Handle messages received from the client via the positron.help comm.
        """
        data = msg["content"]["data"]

        try:
            request = ShowHelpTopicRequest(**data)
            if self._comm is not None:
                self._comm.send_result(data=True)
            self.show_help(request.params.topic)
        except TypeError as exception:
            if self._comm is not None:
                self._comm.send_error(
                    code=JsonRpcErrorCode.INVALID_REQUEST,
                    message=f"Invalid help request {data}: {exception}",
                )

    def shutdown(self) -> None:
        # shutdown pydoc
        if self._pydoc_thread is not None and self._pydoc_thread.serving:
            logger.info("Stopping pydoc server thread")
            self._pydoc_thread.stop()
            logger.info("Pydoc server thread stopped")
        # shutdown comm
        if self._comm is not None:
            try:
                self._comm.close()
            except Exception:
                pass

    def start(self):
        self._pydoc_thread = start_server()

    def show_help(self, request: Optional[Union[str, Any]]) -> None:
        if self._pydoc_thread is None or not self._pydoc_thread.serving:
            logger.warning("Ignoring help request, the pydoc server is not serving")
            return

        # Map from the object to the URL for the pydoc server.
        # We first use pydoc.resolve, which lets us handle an object or an import path.
        result = None
        try:
            result = pydoc.resolve(thing=request)
        except ImportError:
            pass

        if result is None:
            # We could not resolve to an object, try to get help for the request as a string.
            key = request
        else:
            # We resolved to an object.
            obj = result[0]
            key = get_qualname(obj)

            # Not sure why, but some qualified names cause errors in pydoc. Manually replace these with
            # names that are known to work.
            for old, new in self._QUALNAME_OVERRIDES.items():
                if key.startswith(old):
                    key = key.replace(old, new)
                    break

        url = f"{self._pydoc_thread.url}get?key={key}"

        # Submit the event to the frontend service
        event = ShowHelpParams(content=url, kind=ShowHelpKind.Url, focus=True)
        if self._comm is not None:
            self._comm.send_event(name=HelpFrontendEvent.ShowHelp.value, payload=asdict(event))
