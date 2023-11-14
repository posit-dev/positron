#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

from __future__ import annotations

import builtins
import enum
import logging
import pydoc
from typing import TYPE_CHECKING, Any, Optional, Union
from dataclasses import dataclass, asdict

from .frontend import BaseFrontendEvent, FrontendMessage
from .pydoc import start_server
from .utils import get_qualname

if TYPE_CHECKING:
    from .positron_ipkernel import PositronIPyKernel
    from comm.base_comm import BaseComm

logger = logging.getLogger(__name__)


@enum.unique
class HelpMessageType(str, enum.Enum):
    """
    Enum representing the different types of messages that can be sent over the
    Help comm channel and their associated data.
    """

    # Request from the front end to show a help topic in the Help pane.
    topic_request = "show_help_topic_request"

    # Reply to ShowHelpTopicRequest
    topic_reply = "show_help_topic_reply"

    # Notify the front end of new content in the Help pane.
    show_help = "show_help_event"


@enum.unique
class ShowHelpEventKind(str, enum.Enum):
    """
    Kind of content shown in the help pane.
    """

    html = "html"
    markdown = "markdown"
    url = "url"


@dataclass
class ShowHelpContent:
    """
    Show help content in the help pane.
    """

    # URL of help content to be shown
    content: str

    kind: ShowHelpEventKind

    # Focus the Help pane after the Help content has been rendered
    focus: bool

    # Notify the front end of new content in the Help pane.
    msg_type: HelpMessageType = HelpMessageType.show_help


@dataclass
class ShowTopicReply:
    found: bool
    msg_type: HelpMessageType = HelpMessageType.topic_reply


@dataclass
class ShowTopicRequest:
    topic: str
    msg_type: HelpMessageType = HelpMessageType.topic_request


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

    def __init__(self, kernel: PositronIPyKernel):
        self.kernel = kernel
        self._comm: Optional[BaseComm] = None
        self.pydoc_thread = None

    def on_comm_open(self, comm: BaseComm, msg) -> None:
        self._comm = comm
        comm.on_msg(self.receive_message)

    def receive_message(self, msg) -> None:
        """
        Handle messages received from the client via the positron.help comm.
        """
        data = msg["content"]["data"]
        msg_type = data.get("msg_type", None)

        if msg_type == HelpMessageType.topic_request:
            event = ShowTopicReply(found=True)
            self._send_event(event)
            self.show_help(data["topic"])

    def shutdown(self) -> None:
        # shutdown pydoc
        if self.pydoc_thread is not None and self.pydoc_thread.serving:
            logger.info("Stopping pydoc server thread")
            self.pydoc_thread.stop()
            logger.info("Pydoc server thread stopped")
        # shutdown comm
        if self._comm is not None:
            try:
                self._comm.close()
            except Exception:
                pass

    def start(self):
        self.pydoc_thread = start_server()

        if self.pydoc_thread and self.pydoc_thread.serving:
            self._override_help()

    def _override_help(self) -> None:
        # Patch the shell's help function.
        self.kernel.shell.user_ns_hidden["help"] = help
        self.kernel.shell.user_ns["help"] = help

        # Patch our own help function too so that `pydoc.resolve` resolves to it.
        builtins.help = help

    def show_help(self, request: Optional[Union[str, Any]]) -> None:
        if self.pydoc_thread is None:
            logger.warning("Ignoring help request, the pydoc server is not running")
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

        url = f"{self.pydoc_thread.url}get?key={key}"

        # Submit the event to the frontend service
        event = ShowHelpContent(content=url, kind=ShowHelpEventKind.url, focus=True)
        self._send_event(event)

    def _send_event(self, event: Union[ShowHelpContent, ShowTopicReply]) -> None:
        if self._comm is None:
            logger.warning("Cannot send message, frontend comm is not open")
            return

        msg = asdict(event)

        self._comm.send(msg)
