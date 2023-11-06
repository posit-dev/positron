#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import enum
import logging
import uuid
from typing import Any, Dict, List

import comm

from ._pydantic_compat import BaseModel, Field, NonNegativeInt
from .utils import json_clean

logger = logging.getLogger(__name__)


class DataColumn(BaseModel):
    """
    A single column of data. The viewer deals with data in columnar format since
    that best matches the way data is stored in most data sources.
    """

    name: str = Field(description="The name of the column")
    type: str = Field(description="The data type of the column")
    # TODO: Consider using List[SkipValidation[Any]] when we upgrade to pydantic 2.0. We currently
    # aren't validating anything due to performance reasons but probably only need to skip `data`.
    data: List[Any] = Field(description="The data in the column")


class DataSet(BaseModel):
    """
    A data set that can be displayed in the data viewer.
    """

    id: str = Field(description="The unique ID of the dataset")
    title: str = Field(
        default="Data",
        description="The title of the dataset, to be displayed in the viewer",
    )
    columns: List[DataColumn] = Field(default=[], description="The columns of data in the dataset")
    rowCount: NonNegativeInt = Field(
        default=0, description="The total number of rows in the dataset"
    )

    def _slice_data(self, start: int, size: int) -> List[DataColumn]:
        """
        Slice the data in the dataset and return the requested set of rows.
        """
        if start < 0 or start >= self.rowCount:
            raise ValueError(f"Invalid start row: {start}")
        if start == 0 and self.rowCount <= size:
            # No need to slice the data
            return self.columns
        return [
            DataColumn(
                name=column.name,
                type=column.type,
                data=column.data[start : start + size],
            )
            for column in self.columns
        ]


@enum.unique
class DataViewerMessageTypeInput(str, enum.Enum):
    """
    The possible types of messages that can be sent to the language runtime as
    requests to the data viewer backend.
    """

    # A request for the initial batch of data
    ready = "ready"

    # A request for an additional batch of data
    request_rows = "request_rows"


@enum.unique
class DataViewerMessageTypeOutput(str, enum.Enum):
    """
    The possible types of messages that can be sent from the language runtime to
    the data viewer client to be rendered.
    """

    # The initial batch of data
    initial_data = "initial_data"

    # An additional batch of data
    receive_rows = "receive_rows"

    # An error message
    error = "error"


class DataViewerMessageOutput(BaseModel):
    """
    A message sent from the language runtime to the data viewer client.
    """

    msg_type: DataViewerMessageTypeOutput


class DataViewerMessageError(DataViewerMessageOutput):
    msg_type: DataViewerMessageTypeOutput = DataViewerMessageTypeOutput.error
    error: str = Field(description="The error message")

    class Config:
        fields = {"msg_type": {"const": True}}


class DataViewerMessageInitialData(DataViewerMessageOutput):
    msg_type: DataViewerMessageTypeOutput = DataViewerMessageTypeOutput.initial_data

    # For initial data, the start row should always be 0
    start_row: NonNegativeInt = Field(
        default=0, description="The index of the first row in the batch"
    )
    fetch_size: NonNegativeInt = Field(default=100, description="The number of rows in the batch")
    data: DataSet = Field(description="The data to be rendered")

    class Config:
        fields = {"msg_type": {"const": True}, "start_row": {"const": True}}


class DataViewerMessageReceiveRows(DataViewerMessageOutput):
    msg_type: DataViewerMessageTypeOutput = DataViewerMessageTypeOutput.receive_rows

    start_row: NonNegativeInt = Field(
        default=0, description="The index of the first row in the batch"
    )
    fetch_size: NonNegativeInt = Field(default=100, description="The number of rows in the batch")
    data: DataSet = Field(description="The data to be rendered")

    class Config:
        fields = {"msg_type": {"const": True}}


class DataViewerService:
    """
    A service to manage the comms and cached datasets for the client data viewer.
    """

    def __init__(self, target_name: str):
        self.comms: Dict[str, comm.base_comm.BaseComm] = {}
        self.datasets: Dict[str, DataSet] = {}
        self.target_name = target_name

    def register_dataset(self, dataset: DataSet) -> None:
        """
        Register a dataset with the service. This will create a comm for the
        dataset and cache the dataset for future use.
        """
        id = dataset.id or str(uuid.uuid4())
        self.datasets[id] = dataset
        self.init_comm(id, dataset.title)

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
        msg_type = msg_data.get("msg_type")

        dataset = self.datasets.get(comm_id)
        if dataset is None:
            logger.warning(f"Data viewer dataset {comm_id} not found")
            return

        dataview_comm = self.comms.get(comm_id)
        if dataview_comm is None:
            logger.warning(f"Cannot send message, data viewer comm {comm_id} is not open")
            return

        if msg_type == DataViewerMessageTypeInput.ready:
            self.send_data(
                msg_data.get("start_row", 0),
                msg_data.get("fetch_size", 100),
                DataViewerMessageTypeOutput.initial_data,
                dataset,
                dataview_comm,
            )
        elif msg_type == DataViewerMessageTypeInput.request_rows:
            self.send_data(
                msg_data.get("start_row", 0),
                msg_data.get("fetch_size", 100),
                DataViewerMessageTypeOutput.receive_rows,
                dataset,
                dataview_comm,
            )
        else:
            self._send_error(f"Unknown message type '{msg_type}'", dataview_comm)

    def send_data(
        self,
        start_row: NonNegativeInt,
        fetch_size: NonNegativeInt,
        response_type: DataViewerMessageTypeOutput,
        dataset: DataSet,
        comm: comm.base_comm.BaseComm,
    ) -> None:
        response_dataset = DataSet(
            id=dataset.id,
            title=dataset.title,
            columns=dataset._slice_data(start_row, fetch_size),
            rowCount=dataset.rowCount,
        )

        data_message_params = {
            "start_row": start_row,
            "fetch_size": fetch_size,
            "data": response_dataset,
        }
        response_msg = (
            DataViewerMessageInitialData(**data_message_params)
            if response_type == DataViewerMessageTypeOutput.initial_data
            else DataViewerMessageReceiveRows(**data_message_params)
        )
        self._send_message(response_msg, comm)

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

    def _send_message(self, msg: DataViewerMessageOutput, comm: comm.base_comm.BaseComm) -> None:
        """
        Send a message through the data viewer comm to the client.
        """
        msg_dict = json_clean(msg.dict())
        comm.send(msg_dict)  # type: ignore

    def _send_error(self, error_message: str, comm: comm.base_comm.BaseComm) -> None:
        """
        Send an error message through the data viewer comm to the client.
        """
        msg = DataViewerMessageError(error=error_message)
        self._send_message(msg, comm)
