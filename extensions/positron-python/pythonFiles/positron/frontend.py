#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import logging

from ipykernel.comm.comm import BaseComm
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class BaseFrontendEvent(BaseModel):
    """
    Event submitted to the `FrontendService`.
    """

    name: str

    class Config:
        fields = {"name": {"const": True, "exclude": True, "description": "Name of the event."}}


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
        self.comm = None

    def on_comm_open(self, comm: BaseComm, msg) -> None:
        self.comm = comm
        comm.on_msg(self.receive_message)

    def receive_message(self, msg) -> None:
        pass

    def shutdown(self) -> None:
        if self.comm is not None:
            try:
                self.comm.close()
            except Exception:
                pass

    def send_event(self, event: BaseFrontendEvent) -> None:
        if self.comm is None:
            logger.warning("Cannot send message, frontend comm is not open")
            return

        # Convert the event to a message that the client understands and send it over the comm
        msg = FrontendMessage.from_event(event).dict()
        logger.debug(msg)
        self.comm.send(msg)
