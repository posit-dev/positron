#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

import uuid
from dataclasses import asdict
from typing import cast

import pytest

from positron.dataviewer import (
    DataColumn,
    DataSet,
    DataViewerMessageTypeInput,
    DataViewerMessageTypeOutput,
    DataViewerService,
)

from .conftest import DummyComm
from .utils import comm_message, comm_open_message, comm_request

TARGET_NAME = "target_name"


@pytest.fixture()
def dataviewer_service() -> DataViewerService:
    """
    The Positron dataviewer service.
    """
    return DataViewerService(TARGET_NAME)


@pytest.fixture()
def dataset() -> DataSet:
    return DataSet(
        id=str(uuid.uuid4()),
        title="CountryCallingCodes",
        columns=[
            DataColumn(name="codes", type="int", data=[1, 33, 39]),
            DataColumn(name="countries", type="string", data=["Canada", "France", "Italy"]),
        ],
        rowCount=3,
    )


def test_register_dataset(dataviewer_service: DataViewerService, dataset: DataSet) -> None:
    # Arrange
    id = dataset.id

    # Act
    dataviewer_service.register_dataset(dataset)

    # Assert
    assert dataviewer_service.datasets[id] == dataset
    assert id in dataviewer_service.comms
    comm = cast(DummyComm, dataviewer_service.comms[id])
    assert comm.target_name == TARGET_NAME
    assert comm.comm_id == id
    assert comm.messages == [comm_open_message(TARGET_NAME, {"title": dataset.title})]


@pytest.fixture
def dataset_comm(dataviewer_service: DataViewerService, dataset: DataSet) -> DummyComm:
    """
    A comm corresponding to a test dataset belonging to the Positron dataviewer service.
    """
    # Register a dataset, which opens a corresponding comm.
    dataviewer_service.register_dataset(dataset)

    # Clear any existing messages
    dataset_comm = cast(DummyComm, dataviewer_service.comms[dataset.id])
    dataset_comm.messages.clear()

    return dataset_comm


def test_handle_ready(dataset_comm: DummyComm, dataset: DataSet) -> None:
    # Arrange
    msg = comm_request(
        {
            "msg_type": DataViewerMessageTypeInput.ready,
            "start_row": 0,
            "fetch_size": 100,
        },
        content={"comm_id": dataset.id},
    )

    # Act
    dataset_comm.handle_msg(msg)

    # Assert
    assert dataset_comm.messages == [
        comm_message(
            {
                "msg_type": DataViewerMessageTypeOutput.initial_data,
                "data": asdict(dataset),
                "fetch_size": 100,
                "start_row": 0,
            }
        )
    ]


def test_handle_request_rows(dataset_comm: DummyComm, dataset: DataSet) -> None:
    # Arrange
    msg = comm_request(
        {
            "msg_type": DataViewerMessageTypeInput.request_rows,
            "start_row": 0,
            "fetch_size": 100,
        },
        content={"comm_id": dataset.id},
    )

    # Act
    dataset_comm.handle_msg(msg)

    # Assert
    assert dataset_comm.messages == [
        comm_message(
            {
                "msg_type": DataViewerMessageTypeOutput.receive_rows,
                "data": asdict(dataset),
                "fetch_size": 100,
                "start_row": 0,
            }
        )
    ]


def test_shutdown(dataviewer_service: DataViewerService, dataset_comm: DummyComm) -> None:
    # Double-check that it still has datasets and comms
    assert len(dataviewer_service.datasets) == 1
    assert len(dataviewer_service.comms) == 1

    # Double-check that the comm is not yet closed
    assert not dataset_comm._closed

    dataviewer_service.shutdown()

    # Datasets and comms are closed and cleared
    assert dataset_comm._closed
    assert dataviewer_service.datasets == {}
    assert dataviewer_service.comms == {}
