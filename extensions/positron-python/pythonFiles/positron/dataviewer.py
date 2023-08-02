#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import comm
import uuid
import logging
import enum
from typing import List

from .utils import json_clean

logger = logging.getLogger(__name__)


@enum.unique
class DataViewerMessageType(str, enum.Enum):
    """
    Message types used in the positron.dataviewer comm.
    """

    READY = "ready"
    INITIAL_DATA = "initial_data"
    REQUEST_ROWS = "request_rows"
    RECEIVE_ROWS = "receive_rows"


class DataColumn(dict):
    """
    A single column of data. The viewer deals with data in columnar format since
    that best matches the way data is stored in most data sources.
    """

    def __init__(self, name: str, type: str, data: list):
        self["name"] = name
        self["type"] = type
        self["data"] = data


class DataSet(dict):
    """
    A data set that can be displayed in the data viewer.
    """

    def __init__(self, id: str, title: str, columns: List[DataColumn], rowCount: int):
        self["id"] = id
        self["title"] = title
        self["columns"] = columns
        self["rowCount"] = rowCount

    def _slice_data(self, start: int, size: int) -> List[DataColumn]:
        """
        Slice the data in the dataset and return the requested set of rows.
        """
        if start < 0 or start >= self.get("rowCount", 0):
            raise ValueError(f"Invalid start row: {start}")
        if start == 0 and self.get("rowCount", 0) <= size:
            # No need to slice the data
            return self.get("columns", list())
        return [
            DataColumn(
                column.get("name"), column.get("type"), column.get("data")[start : start + size]
            )
            for column in self.get("columns", list())
        ]


class DataViewerRowResponse(dict):
    """
    A message sent from the runtime containing the batch of rows to be rendered
    """

    def __init__(self, msg_type: str, start_row: int, fetch_size: int, data: DataSet):
        self["msg_type"] = msg_type
        self["start_row"] = start_row
        self["fetch_size"] = fetch_size
        self["data"] = data


class DataViewerService:
    """
    A service to manage the comms and cached datasets for the client data viewer.
    """

    def __init__(self, target_name: str):
        self.comms = {}
        self.datasets = {}
        self.target_name = target_name

    def register_dataset(self, dataset: DataSet) -> None:
        """
        Register a dataset with the service. This will create a comm for the
        dataset and cache the dataset for future use.
        """
        id = dataset.get("id", str(uuid.uuid4()))
        self.datasets[id] = dataset
        self.init_comm(id, dataset.get("title", "Data"))

    def has_dataset(self, id: str) -> bool:
        return id in self.datasets

    def init_comm(self, comm_id: str, title: str) -> None:
        dataview_comm = self._create_comm(comm_id, title=title)
        self.comms[comm_id] = dataview_comm
        dataview_comm.on_msg(self.receive_message)

    def receive_message(self, msg) -> None:
        """
        Handle client messages to send more data to the data viewer.
        """
        comm_id = msg["content"]["comm_id"]
        msg_data = msg["content"]["data"]
        msg_type = msg_data.get("msg_type", None)
        if msg_type not in [DataViewerMessageType.READY, DataViewerMessageType.REQUEST_ROWS]:
            raise ValueError(f"Invalid message type: {msg_type}")

        dataset = self.datasets.get(comm_id, None)
        if dataset is None:
            logger.warning(f"Data viewer dataset {comm_id} not found")
            return

        dataview_comm = self.comms.get(comm_id, None)
        if dataview_comm is None:
            logger.warning(f"Data viewer comm {comm_id} not found")
            return

        response_type = (
            DataViewerMessageType.INITIAL_DATA
            if msg_type == DataViewerMessageType.READY
            else DataViewerMessageType.RECEIVE_ROWS
        )
        start_row = msg_data.get("start_row", 0)
        fetch_size = msg_data.get("fetch_size", 100)
        response_dataset = DataSet(
            dataset.get("id"),
            dataset.get("title"),
            dataset._slice_data(start_row, fetch_size),
            dataset.get("rowCount"),
        )

        response_msg = json_clean(
            DataViewerRowResponse(
                msg_type=response_type,
                start_row=start_row,
                fetch_size=fetch_size,
                data=response_dataset,
            )
        )
        dataview_comm.send(data=response_msg)

    def shutdown(self) -> None:
        for dataview_comm in self.comms.values():
            try:
                dataview_comm.close()
            except Exception:
                pass
        self.comms.clear()
        self.datasets.clear()

    # -- Private Methods --
    def _create_comm(self, comm_id: str, title: str):
        return comm.create_comm(
            target_name=self.target_name, comm_id=comm_id, data={"title": title}
        )
