#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

from __future__ import annotations

import asyncio
import enum
import logging
import pydoc
from typing import TYPE_CHECKING, Any, Optional, Union

from pydantic import Field

from .frontend import BaseFrontendEvent
from .pydoc import patch_pydoc
from .utils import get_qualname

if TYPE_CHECKING:
    from .frontend import FrontendService
    from .positron_ipkernel import PositronIPyKernel

logger = logging.getLogger(__name__)


@enum.unique
class ShowHelpEventKind(str, enum.Enum):
    """
    Kind of content shown in the help pane.
    """

    html = "html"
    markdown = "markdown"
    url = "url"


class ShowHelpEvent(BaseFrontendEvent):
    """
    Show help content in the help pane.
    """

    content: str = Field(description="Help content to be shown")
    kind: ShowHelpEventKind
    focus: bool = Field(description="Focus the Help pane after the Help content has been rendered?")

    name: str = "show_help"


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

    def __init__(self, kernel: PositronIPyKernel, frontend_service: FrontendService):
        self.kernel = kernel
        self.frontend_service = frontend_service
        self.pydoc_thread = None

    def start(self):
        self.pydoc_thread = self._start_pydoc_server()

        if self.pydoc_thread and self.pydoc_thread.serving:
            self._override_help()

    def _start_pydoc_server(self):
        """Adapted from pydoc.browser."""
        # Monkey patch pydoc for our custom functionality
        patch_pydoc()

        # Setting port to 0 will use an arbitrary port
        pydoc_thread = pydoc._start_server(pydoc._url_handler, hostname="localhost", port=0)  # type: ignore

        if pydoc_thread.error:
            logger.error(f"Could not start the pydoc help server. Error: {pydoc_thread.error}")
            return
        elif pydoc_thread.serving:
            logger.info(f"Pydoc server ready at: {pydoc_thread.url}")

        return pydoc_thread

    def _override_help(self) -> None:
        # Run code in the kernel which overrides the builtin help function, to call `self.show_help`
        coro = self.kernel.do_execute(
            f"""
import builtins

def help(topic="help"):
    '''
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
    '''
    from ipykernel.ipkernel import IPythonKernel

    if IPythonKernel.initialized():
        kernel = IPythonKernel.instance()
        kernel.help_service.show_help(topic)
    else:
        raise Exception("Unexpected error. No IPythonKernel has been initialized.")

builtins.help = help
del help  # Clean up the user's namespace
""",
            silent=True,
        )
        loop = asyncio.get_event_loop()
        asyncio.run_coroutine_threadsafe(coro, loop)

    def shutdown(self) -> None:
        if self.pydoc_thread is not None and self.pydoc_thread.serving:
            logger.info("Stopping pydoc server thread")
            self.pydoc_thread.stop()

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
        event = ShowHelpEvent(content=url, kind=ShowHelpEventKind.url, focus=True)
        self.frontend_service.send_event(event)
