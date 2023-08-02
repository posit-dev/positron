#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import os
import sys
import uuid

import pytest

# append project parent to the path so that we can import the positron module
current = os.path.dirname(os.path.realpath(__file__))
parent = os.path.dirname(current)
sys.path.append(parent)

from positron import DataColumn, DataSet, DataViewerService, DataViewerMessageType

# -- Mocks --


class MockComm:
    """
    A mock comm object to run unit tests without a kernel.
    """

    def __init__(self, target_name: str, data: dict, comm_id: str, **kwargs):
        self.target_name = target_name
        self.data = data
        self.comm_id = comm_id

    def on_msg(self, callback) -> None:
        pass

    def close(self, data=None, metadata=None, buffers=None, deleting=False) -> None:
        pass

    def send(self, data=None, metadata=None, buffers=None) -> None:
        pass


# -- Tests for DataViewerService --


class TestDataViewerService:
    # -- Fixtures --

    @pytest.fixture(scope="class", autouse=True)
    def target_name(self) -> str:
        return "positron.dataviewer"

    @pytest.fixture(scope="class", autouse=True)
    def random_id(self) -> str:
        return str(uuid.uuid4())

    @pytest.fixture(scope="function", autouse=True)
    def dataviewer_service(self, target_name) -> DataViewerService:
        return DataViewerService(target_name)

    @pytest.fixture(scope="function", autouse=True)
    def dataset(self, random_id: str) -> DataSet:
        return DataSet(
            random_id,
            "CountryCallingCodes",
            [
                DataColumn("codes", "int", [1, 33, 39]),
                DataColumn("countries", "string", ["Canada", "France", "Italy"]),
            ],
            3,
        )

    @pytest.fixture(scope="function", autouse=True)
    def mock_comm(self, target_name: str, random_id: str) -> MockComm:
        message = {
            "content": {
                "comm_id": random_id,
                "data": {
                    "msg_type": DataViewerMessageType.READY,
                    "start_row": 0,
                    "fetch_size": 100,
                },
            }
        }

        return MockComm(target_name=target_name, data=message, comm_id=random_id)

    # -- Tests --

    def test_register_dataset(self, mocker, dataviewer_service, dataset, mock_comm):
        # Arrange
        id = dataset.get("id")
        mocker.patch.object(dataviewer_service, "_create_comm", return_value=mock_comm)
        comm_onmsg_spy = mocker.spy(mock_comm, "on_msg")

        # Act
        dataviewer_service.register_dataset(dataset)

        # Assert
        assert dataviewer_service.has_dataset(id)
        assert dataviewer_service.datasets[id] == dataset
        assert dataviewer_service.comms[id] == mock_comm
        assert comm_onmsg_spy.call_count == 1

    def test_receive_message(self, mocker, dataviewer_service, dataset, mock_comm):
        # Arrange
        id = dataset.get("id")
        mocker.patch.object(dataviewer_service, "_create_comm", return_value=mock_comm)
        comm_send_spy = mocker.spy(mock_comm, "send")

        # Act
        dataviewer_service.register_dataset(dataset)
        dataviewer_service.receive_message(mock_comm.data)

        # Assert
        comm_send_spy.assert_called_once()
        call_kwargs = comm_send_spy.call_args_list[0].kwargs
        assert call_kwargs["data"]["msg_type"] == DataViewerMessageType.INITIAL_DATA
        assert call_kwargs["data"]["data"]["id"] == dataset.get("id")

    def test_shutdown(self, mocker, dataviewer_service, dataset, mock_comm):
        # Arrange
        id = dataset.get("id")
        mocker.patch.object(dataviewer_service, "_create_comm", return_value=mock_comm)
        comm_close_spy = mocker.spy(mock_comm, "close")
        dataviewer_service.register_dataset(dataset)

        # Act
        assert dataviewer_service.has_dataset(id)
        dataviewer_service.shutdown()

        # Assert
        assert not dataviewer_service.has_dataset(id)
        assert len(dataviewer_service.datasets) == 0
        assert comm_close_spy.call_count == 1
