#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

import enum
import json
import logging
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Mapping, Optional

import comm
from comm.base_comm import BaseComm

logger = logging.getLogger(__name__)

_WIDGET_MIME_TYPE = "application/vnd.jupyter.widget-view+json"


@enum.unique
class WidgetRequest(str, enum.Enum):
    """
    The possible types of messages that can be sent to the frontend as
    requests from the language runtime.
    """

    # A request to display a widget
    display = "display"


@dataclass
class WidgetDisplayMessage:
    """
    A message used to request the frontend display a specific widget or list of widgets.
    """

    msg_type: WidgetRequest = WidgetRequest.display
    view_ids: List[str] = field(
        default_factory=list,
        metadata={"description": "The list of widget view ids to display"},
    )


class PositronWidgetHook:
    def __init__(self, target_name, comm_manager):
        self.comms: Dict[str, comm.base_comm.BaseComm] = {}
        self.target_name = target_name
        self.comm_manager = comm_manager

    def __call__(self, msg, *args, **kwargs) -> Optional[dict]:
        if msg["msg_type"] == "display_data":
            # If there is no widget, let the parent deal with the msg.
            data = msg["content"]["data"]
            if _WIDGET_MIME_TYPE not in data:
                logger.warning("No widget MIME type found.")
                return msg

            comm_id = data[_WIDGET_MIME_TYPE].get("model_id")

            if comm_id is None:
                logger.warning("No comm associated with widget.")
                return msg

            # find comm associated with the widget
            self.comms[comm_id] = self.comm_manager.get_comm(comm_id)
            self._receive_message(comm_id)

            return None

        return msg

    def _receive_message(self, comm_id) -> None:
        """
        Handle client messages to render a widget figure.
        """
        widget_comm = self.comms.get(comm_id)

        if widget_comm is None:
            logger.warning(f"Widget comm {comm_id} not found")
            return

        try:
            data = WidgetDisplayMessage(view_ids=[comm_id])
        except TypeError as exception:
            logger.warning(f"Widget invalid data: {exception}")
            return

        widget_comm.send(data=asdict(data))

    def shutdown(self) -> None:
        """
        Shutdown widget comms and release any resources.
        """
        for widget_comm in self.comms.values():
            try:
                widget_comm.close()
            except Exception:
                pass
        self.comms.clear()
