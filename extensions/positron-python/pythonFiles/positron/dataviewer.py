#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#
from .utils import json_clean
from ipykernel.ipkernel import comm

class DataColumn(dict):

    def __init__(self, name: str, type: str, data: list):
        self['name'] = name
        self['type'] = type
        self['data'] = data

class DataSet(dict):

    def __init__(self, id: str, title: str, columns: list):
        self['id'] = id
        self['title'] = title
        self['columns'] = columns

class DataViewerService:

    def __init__(self, target_name: str):
        self.comms = {}
        self.datasets = {}
        self.target_name = target_name

    def register_dataset(self, dataset: DataSet) -> None:
        id = dataset.get('id', None)
        self.datasets[id] = dataset
        self.create_comm(id, dataset)

    def has_dataset(self, id: str) -> bool:
        return id in self.datasets

    def create_comm(self, comm_id: str, dataset: DataSet) -> None:
        data = json_clean(dataset)
        dataview_comm = comm.create_comm(target_name=self.target_name,
                                         comm_id=comm_id,
                                         data=data)
        self.comms[comm_id] = dataview_comm
        dataview_comm.on_msg(self.receive_message)

    def receive_message(self, msg) -> None:
       pass

    def shutdown(self) -> None:
        try:
            for dataview_comm in self.comms.values():
                try:
                    dataview_comm.close()
                except Exception:
                    pass
            self.comms.clear()
            self.datasets.clear()
        except Exception:
            pass
