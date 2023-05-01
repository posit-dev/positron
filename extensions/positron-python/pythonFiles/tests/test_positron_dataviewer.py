#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import os
import sys

# append project parent to the path
current = os.path.dirname(os.path.realpath(__file__))
parent = os.path.dirname(current)
sys.path.append(parent)

import pytest
import uuid
from positron import DataColumn, DataSet, DataViewerService


class TestDataViewerService:

    @pytest.fixture(scope='class', autouse=True)
    def dataviewer_service(self) -> DataViewerService:
        return DataViewerService('positron.dataviewer')

    def test_register_dataset(self, mocker, dataviewer_service):

        # Arrange
        id = str(uuid.uuid4())
        data = {}
        mock_comm = MockComm(id, data)
        mocker.patch.object(dataviewer_service, '_create_comm', return_value=mock_comm)
        onmsg_spy = mocker.spy(mock_comm, 'on_msg')

        dataset = DataSet(id, 'CountryCallingCodes', [
            DataColumn('codes', 'int', [1, 33, 39]),
            DataColumn('countries', 'string', ['Canada', 'France', 'Italy'])
        ])

        # Act
        dataviewer_service.register_dataset(dataset)

        # Assert
        assert dataviewer_service.has_dataset(id)
        assert dataviewer_service.datasets[id] == dataset
        assert dataviewer_service.comms[id] is not None
        assert dataviewer_service.comms[id]['comm_id'] == id
        assert onmsg_spy.call_count == 1

    def test_shutdown(self, dataviewer_service):

        # Arrange
        dataset = DataSet(str(uuid.uuid4()), 'TestDS', [])
        dataviewer_service.register_dataset(dataset)

        # Act
        dataviewer_service.shutdown()

        # Assert
        assert not dataviewer_service.has_dataset(id)
        assert len(dataviewer_service.datasets) == 0

class MockComm(dict):

    def __init__(self, comm_id: str, data: dict):
        self['comm_id'] = comm_id
        self['data'] = data

    def on_msg(self, msg):
        pass
