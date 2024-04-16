#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#

import sqlite3
from typing import Tuple

import pytest
import sqlalchemy
from positron_ipykernel.connections import ConnectionsService

from .conftest import DummyComm
from .utils import json_rpc_request

TARGET_NAME = "positron.connections"


def add_default_data(execute):
    execute("CREATE TABLE movie(title TEXT, year INTEGER, score NUMERIC)")
    execute("INSERT INTO movie VALUES('The Shawshank Redemption', 1994, 9.3)")
    execute("INSERT INTO movie VALUES('The Godfather', 1972, 9.2)")
    execute("INSERT INTO movie VALUES('The Dark Knight', 2008, 9.0)")


def get_sqlalchemy_sqlite_connection():
    con = sqlalchemy.create_engine("sqlite://")
    add_default_data(lambda sql: con.connect().execute(sqlalchemy.text(sql)))
    return con


def get_sqlite3_sqlite_connection():
    con = sqlite3.connect(":memory:")
    add_default_data(lambda sql: con.cursor().execute(sql))
    return con


def get_sqlite_connections():
    return [get_sqlalchemy_sqlite_connection(), get_sqlite3_sqlite_connection()]


@pytest.fixture(scope="function")
def connections_comm(
    connections_service: ConnectionsService, con
) -> Tuple[ConnectionsService, DummyComm]:
    comm_id = connections_service.register_connection(con)

    dummy_comm = DummyComm(TARGET_NAME, comm_id=comm_id)
    connections_service.on_comm_open(dummy_comm)
    dummy_comm.messages.clear()

    return connections_service, dummy_comm


@pytest.mark.parametrize("con", get_sqlite_connections())
class TestSQLiteConnectionsService:
    def test_register_connection(self, connections_service: ConnectionsService, con):
        comm_id = connections_service.register_connection(con)
        assert comm_id in connections_service.comms

    @pytest.mark.parametrize(
        "path,expected",
        [
            ([], False),
            ([{"kind": "schema", "name": "main"}], True),
        ],
    )
    def test_contains_data(
        self, connections_comm: Tuple[ConnectionsService, DummyComm], path, expected
    ):
        _, comm = connections_comm

        msg = self._make_msg(params={"path": path}, method="contains_data", comm_id=comm.comm_id)
        comm.handle_msg(msg)

        result = comm.messages[0]["data"]["result"]
        assert result is False

    @pytest.mark.parametrize(
        "path,expected",
        [
            ([], ""),
            ([{"kind": "schema", "name": "main"}], ""),
        ],
    )
    def test_get_icon(self, connections_comm: Tuple[ConnectionsService, DummyComm], path, expected):
        _, comm = connections_comm

        msg = self._make_msg(params={"path": path}, method="get_icon", comm_id=comm.comm_id)
        comm.handle_msg(msg)
        result = comm.messages[0]["data"]["result"]
        assert result == expected

    @pytest.mark.parametrize(
        "path,expected",
        [
            ([], [{"kind": "schema", "name": "main"}]),
            ([{"kind": "schema", "name": "main"}], [{"kind": "table", "name": "movie"}]),
        ],
    )
    def test_list_objects(
        self, connections_comm: Tuple[ConnectionsService, DummyComm], path, expected
    ):
        _, comm = connections_comm

        msg = self._make_msg(params={"path": path}, method="list_objects", comm_id=comm.comm_id)

        comm.handle_msg(msg)
        result = comm.messages[0]["data"]["result"]
        assert len(result) == 1
        assert result == expected

    def test_list_fields(self, connections_comm: Tuple[ConnectionsService, DummyComm]):
        _, comm = connections_comm

        msg = self._make_msg(
            params={
                "path": [{"kind": "schema", "name": "main"}, {"kind": "table", "name": "movie"}]
            },
            method="list_fields",
            comm_id=comm.comm_id,
        )
        comm.handle_msg(msg)
        result = comm.messages[0]["data"]["result"]
        assert len(result) == 3
        assert result[0] == {"name": "title", "dtype": "TEXT"}
        assert result[1] == {"name": "year", "dtype": "INTEGER"}
        assert result[2] == {"name": "score", "dtype": "NUMERIC"}

    def test_preview_object(self, connections_comm: Tuple[ConnectionsService, DummyComm]):
        service, comm = connections_comm

        msg = self._make_msg(
            params={
                "path": [{"kind": "schema", "name": "main"}, {"kind": "table", "name": "movie"}]
            },
            method="preview_object",
            comm_id=comm.comm_id,
        )
        comm.handle_msg(msg)
        # cleanup the data_explorer state, so we don't break its own tests
        service._kernel.data_explorer_service.shutdown()
        result = comm.messages[0]["data"]["result"]
        assert result is None

    def _make_msg(self, method, params, comm_id):
        return json_rpc_request(method=method, params=params, comm_id=comm_id)
