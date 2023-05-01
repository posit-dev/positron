#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import comm
import uuid

from .utils import json_clean


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

    def __init__(self, id: str, title: str, columns: list):
        self["id"] = id
        self["title"] = title
        self["columns"] = columns


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
        self.init_comm(id, dataset)

    def has_dataset(self, id: str) -> bool:
        return id in self.datasets

    def init_comm(self, comm_id: str, dataset: DataSet) -> None:
        data = json_clean(dataset)
        dataview_comm = self._create_comm(comm_id, data)
        self.comms[comm_id] = dataview_comm
        dataview_comm.on_msg(self.receive_message)

    def receive_message(self, msg) -> None:
        pass

    def shutdown(self) -> None:
        for dataview_comm in self.comms.values():
            try:
                dataview_comm.close()
            except Exception:
                pass
        self.comms.clear()
        self.datasets.clear()

    # -- Private Methods --

    def _create_comm(self, comm_id: str, data):
        return comm.create_comm(target_name=self.target_name, comm_id=comm_id, data=data)
