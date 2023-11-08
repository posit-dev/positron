#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import logging
from pathlib import Path
from typing import Optional

from comm.base_comm import BaseComm
from ._pydantic_compat import BaseModel, Field

logger = logging.getLogger(__name__)


class BaseFrontendEvent(BaseModel):
    """
    Event submitted to the `FrontendService`.
    """

    name: str

    class Config:
        fields = {"name": {"const": True, "exclude": True, "description": "Name of the event."}}


class WorkingDirectoryEvent(BaseFrontendEvent):
    """
    Change the displayed working directory for the interpreter.
    """

    directory: str = Field(description="The new working directory.")

    name: str = "working_directory"


class FrontendMessage(BaseModel):
    """
    Message sent over the Positron frontend comm channel.
    """

    msg_type: str = "event"
    name: str = Field(description="Name of the event")
    data: BaseFrontendEvent

    @classmethod
    def from_event(cls, event: BaseFrontendEvent) -> "FrontendMessage":
        return cls(name=event.name, data=event)


class FrontendService:
    """
    Wrapper around a comm channel whose lifetime matches that of the Positron frontend.
    Used for communication with the frontend, unscoped to any particular view.
    """

    def __init__(self):
        self._comm = None

        self._working_directory: Optional[Path] = None

    def on_comm_open(self, comm: BaseComm, msg) -> None:
        self._comm = comm
        comm.on_msg(self.receive_message)

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

            # Attempt to alias the directory, if it's within the home directory
            home_dir = Path.home()
            try:
                # relative_to will raise a ValueError if current_dir is not within the home directory
                current_dir = Path("~") / current_dir.relative_to(home_dir)
            except ValueError:
                pass

            # Deliver event to client
            self.send_event(WorkingDirectoryEvent(directory=str(current_dir)))

    def receive_message(self, msg) -> None:
        pass

    def shutdown(self) -> None:
        if self._comm is not None:
            try:
                self._comm.close()
            except Exception:
                pass

    def send_event(self, event: BaseFrontendEvent) -> None:
        if self._comm is None:
            logger.warning("Cannot send message, frontend comm is not open")
            return

        # Convert the event to a message that the client understands and send it over the comm
        msg = FrontendMessage.from_event(event).dict()
        logger.debug(msg)
        self._comm.send(msg)
