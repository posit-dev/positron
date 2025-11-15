#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import os
import sqlite3
from typing import Tuple

import pytest
import sqlalchemy

try:
    import duckdb

    HAS_DUCKDB = True
except ImportError:
    HAS_DUCKDB = False


try:
    if "SNOWFLAKE_ACCOUNT" in os.environ:
        import snowflake.connector

        HAS_SNOWFLAKE = True
    else:
        HAS_SNOWFLAKE = False
except ImportError:
    HAS_SNOWFLAKE = False


try:
    import databricks.sql

    if (
        "DATABRICKS_HOSTNAME" in os.environ
        and "DATABRICKS_HTTP_PATH" in os.environ
        and "DATABRICKS_ACCESS_TOKEN" in os.environ
    ):
        HAS_DATABRICKS = True
    else:
        HAS_DATABRICKS = False
except ImportError:
    HAS_DATABRICKS = False

from positron.access_keys import encode_access_key
from positron.connections import ConnectionsService

from .conftest import DummyComm, PositronShell
from .utils import json_rpc_request, json_rpc_response

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


def get_duckdb_connection():
    if not HAS_DUCKDB:
        pytest.skip("DuckDB not available")
    con = duckdb.connect(":memory:")
    add_default_data(lambda sql: con.execute(sql))
    return con


def get_snowflake_connection():
    if not HAS_SNOWFLAKE:
        pytest.skip("Snowflake not available")

    return snowflake.connector.connect(
        account=os.getenv("SNOWFLAKE_ACCOUNT"),
        user=os.getenv("SNOWFLAKE_USER"),
        password=os.getenv("SNOWFLAKE_PASSWORD"),
        warehouse="DEFAULT_WH",
    )


def get_databricks_connection():
    if not HAS_DATABRICKS:
        pytest.skip("Databricks not available")

    return databricks.sql.connect(
        server_hostname=os.environ["DATABRICKS_HOSTNAME"],
        http_path=os.environ["DATABRICKS_HTTP_PATH"],
        access_token=os.environ["DATABRICKS_ACCESS_TOKEN"],
    )


def get_sqlite_connections():
    return [get_sqlalchemy_sqlite_connection(), get_sqlite3_sqlite_connection()]


def _make_msg(method, params, comm_id):
    return json_rpc_request(method=method, params=params, comm_id=comm_id)


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

    @pytest.mark.parametrize("path", [[], [{"kind": "schema", "name": "main"}]])
    def test_contains_data(self, connections_comm: Tuple[ConnectionsService, DummyComm], path):
        _, comm = connections_comm

        msg = _make_msg(params={"path": path}, method="contains_data", comm_id=comm.comm_id)
        comm.handle_msg(msg)

        result = comm.messages[0]["data"]["result"]
        assert result is False

    @pytest.mark.parametrize(
        ("path", "expected"),
        [
            ([], ""),
            ([{"kind": "schema", "name": "main"}], ""),
        ],
    )
    def test_get_icon(self, connections_comm: Tuple[ConnectionsService, DummyComm], path, expected):
        _, comm = connections_comm

        msg = _make_msg(params={"path": path}, method="get_icon", comm_id=comm.comm_id)
        comm.handle_msg(msg)
        result = comm.messages[0]["data"]["result"]
        assert result == expected

    @pytest.mark.parametrize(
        ("path", "expected"),
        [
            ([], [{"kind": "schema", "name": "main"}]),
            ([{"kind": "schema", "name": "main"}], [{"kind": "table", "name": "movie"}]),
        ],
    )
    def test_list_objects(
        self, connections_comm: Tuple[ConnectionsService, DummyComm], path, expected
    ):
        _, comm = connections_comm

        msg = _make_msg(params={"path": path}, method="list_objects", comm_id=comm.comm_id)

        comm.handle_msg(msg)
        result = comm.messages[0]["data"]["result"]
        assert len(result) == 1
        assert result == expected

    def test_list_fields(self, connections_comm: Tuple[ConnectionsService, DummyComm]):
        _, comm = connections_comm

        msg = _make_msg(
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

        msg = _make_msg(
            params={
                "path": [{"kind": "schema", "name": "main"}, {"kind": "table", "name": "movie"}]
            },
            method="preview_object",
            comm_id=comm.comm_id,
        )
        comm.handle_msg(msg)
        # cleanup the data_explorer state, so we don't break its own tests
        service._kernel.data_explorer_service.shutdown()  # noqa: SLF001
        result = comm.messages[0]["data"]["result"]
        assert result is None


@pytest.mark.skipif(not HAS_DUCKDB, reason="DuckDB not available")
class TestDuckDBConnectionsService:
    def test_register_connection(self, connections_service: ConnectionsService):
        con = get_duckdb_connection()
        comm_id = connections_service.register_connection(con)
        assert comm_id in connections_service.comms

    @pytest.mark.parametrize("path", [[], [{"kind": "schema", "name": "main"}]])
    def test_contains_data(self, connections_service: ConnectionsService, path):
        con = get_duckdb_connection()
        comm_id = connections_service.register_connection(con)

        dummy_comm = DummyComm(TARGET_NAME, comm_id=comm_id)
        connections_service.on_comm_open(dummy_comm)
        dummy_comm.messages.clear()

        msg = _make_msg(params={"path": path}, method="contains_data", comm_id=comm_id)
        dummy_comm.handle_msg(msg)
        result = dummy_comm.messages[0]["data"]["result"]
        assert result is False

    @pytest.mark.parametrize(
        ("path", "expected"),
        [
            ([], "data:image"),
            ([{"kind": "schema", "name": "main"}], ""),
        ],
    )
    def test_get_icon(self, connections_service: ConnectionsService, path, expected):
        con = get_duckdb_connection()
        comm_id = connections_service.register_connection(con)

        dummy_comm = DummyComm(TARGET_NAME, comm_id=comm_id)
        connections_service.on_comm_open(dummy_comm)
        dummy_comm.messages.clear()

        msg = _make_msg(params={"path": path}, method="get_icon", comm_id=comm_id)
        dummy_comm.handle_msg(msg)
        result = dummy_comm.messages[0]["data"]["result"]
        if expected == "":
            assert result == expected
        else:
            assert expected in result

    @pytest.mark.parametrize(
        ("path", "expected_contains"),
        [
            ([], "memory"),  # DuckDB has been connected to memory
            ([{"kind": "catalog", "name": "memory"}], "main"),
            (
                [{"kind": "catalog", "name": "memory"}, {"kind": "schema", "name": "main"}],
                "movie",
            ),  # Should contain our test table
        ],
    )
    def test_list_objects(self, connections_service: ConnectionsService, path, expected_contains):
        con = get_duckdb_connection()
        comm_id = connections_service.register_connection(con)

        dummy_comm = DummyComm(TARGET_NAME, comm_id=comm_id)
        connections_service.on_comm_open(dummy_comm)
        dummy_comm.messages.clear()

        msg = _make_msg(params={"path": path}, method="list_objects", comm_id=comm_id)
        dummy_comm.handle_msg(msg)
        result = dummy_comm.messages[0]["data"]["result"]

        # Check that expected item is in the results
        names = [item["name"] for item in result]
        assert expected_contains in names

    def test_list_fields(self, connections_service: ConnectionsService):
        con = get_duckdb_connection()
        comm_id = connections_service.register_connection(con)

        dummy_comm = DummyComm(TARGET_NAME, comm_id=comm_id)
        connections_service.on_comm_open(dummy_comm)
        dummy_comm.messages.clear()

        msg = _make_msg(
            params={
                "path": [
                    {"kind": "catalog", "name": "memory"},
                    {"kind": "schema", "name": "main"},
                    {"kind": "table", "name": "movie"},
                ]
            },
            method="list_fields",
            comm_id=comm_id,
        )
        dummy_comm.handle_msg(msg)
        result = dummy_comm.messages[0]["data"]["result"]
        assert len(result) == 3
        # DuckDB uses different type names than SQLite
        assert result[0]["name"] == "title"
        assert result[1]["name"] == "year"
        assert result[2]["name"] == "score"

    def test_preview_object(self, connections_service: ConnectionsService):
        con = get_duckdb_connection()
        comm_id = connections_service.register_connection(con)

        dummy_comm = DummyComm(TARGET_NAME, comm_id=comm_id)
        connections_service.on_comm_open(dummy_comm)
        dummy_comm.messages.clear()

        msg = _make_msg(
            params={
                "path": [
                    {"kind": "catalog", "name": "memory"},
                    {"kind": "schema", "name": "main"},
                    {"kind": "table", "name": "movie"},
                ]
            },
            method="preview_object",
            comm_id=comm_id,
        )
        dummy_comm.handle_msg(msg)
        # cleanup the data_explorer state, so we don't break its own tests
        connections_service._kernel.data_explorer_service.shutdown()  # noqa: SLF001
        result = dummy_comm.messages[0]["data"]["result"]
        assert result is None


@pytest.mark.skipif(not HAS_DATABRICKS, reason="Databricks not available")
class TestDatabricksConnectionsService:
    CATALOG_NAME = "workshops"
    SCHEMA_NAME = "positron-samples"
    TABLE_NAME = "flights"

    def _catalog_path(self):
        return [{"kind": "catalog", "name": self.CATALOG_NAME}]

    def _schema_path(self):
        return [*self._catalog_path(), {"kind": "schema", "name": self.SCHEMA_NAME}]

    def _table_path(self):
        return [*self._schema_path(), {"kind": "table", "name": self.TABLE_NAME}]

    def _resolve_path(self, kind: str):
        if kind == "root":
            return []
        if kind == "catalog":
            return self._catalog_path()
        if kind == "schema":
            return self._schema_path()
        if kind == "table":
            return self._table_path()
        raise ValueError(f"Unknown path kind: {kind}")

    def _open_comm(self, connections_service: ConnectionsService):
        con = get_databricks_connection()
        comm_id = connections_service.register_connection(con)
        dummy_comm = DummyComm(TARGET_NAME, comm_id=comm_id)
        connections_service.on_comm_open(dummy_comm)
        dummy_comm.messages.clear()
        return dummy_comm, comm_id

    def test_register_connection(self, connections_service: ConnectionsService):
        con = get_databricks_connection()
        comm_id = connections_service.register_connection(con)
        assert comm_id in connections_service.comms

    @pytest.mark.parametrize(
        "path_kind",
        [
            pytest.param("root", id="root"),
            pytest.param("catalog", id="catalog"),
            pytest.param("schema", id="schema"),
            pytest.param("table", id="table"),
        ],
    )
    def test_contains_data(self, connections_service: ConnectionsService, path_kind: str):
        dummy_comm, comm_id = self._open_comm(connections_service)
        path = self._resolve_path(path_kind)

        msg = _make_msg(params={"path": path}, method="contains_data", comm_id=comm_id)
        dummy_comm.handle_msg(msg)
        result = dummy_comm.messages[0]["data"]["result"]
        assert result is (path_kind == "table")

    @pytest.mark.parametrize(
        ("path_kind", "expected"),
        [
            pytest.param("root", "data:image", id="root"),
            pytest.param("catalog", "", id="catalog"),
            pytest.param("schema", "", id="schema"),
            pytest.param("table", "", id="table"),
        ],
    )
    def test_get_icon(self, connections_service: ConnectionsService, path_kind: str, expected: str):
        dummy_comm, comm_id = self._open_comm(connections_service)
        path = self._resolve_path(path_kind)

        msg = _make_msg(params={"path": path}, method="get_icon", comm_id=comm_id)
        dummy_comm.handle_msg(msg)
        result = dummy_comm.messages[0]["data"]["result"]
        if expected:
            assert expected in result
        else:
            assert result == ""

    @pytest.mark.parametrize(
        ("path_kind", "expected_contains"),
        [
            pytest.param("root", "workshops", id="catalogs"),
            pytest.param("catalog", "positron-samples", id="schemas"),
            pytest.param("schema", "flights", id="tables"),
        ],
    )
    def test_list_objects(
        self, connections_service: ConnectionsService, path_kind: str, expected_contains: str
    ):
        dummy_comm, comm_id = self._open_comm(connections_service)
        path = self._resolve_path(path_kind)

        msg = _make_msg(params={"path": path}, method="list_objects", comm_id=comm_id)
        dummy_comm.handle_msg(msg)
        result = dummy_comm.messages[0]["data"]["result"]
        names = [item["name"] for item in result]
        assert expected_contains in names

    def test_list_fields(self, connections_service: ConnectionsService):
        dummy_comm, comm_id = self._open_comm(connections_service)
        path = self._table_path()

        msg = _make_msg(params={"path": path}, method="list_fields", comm_id=comm_id)
        dummy_comm.handle_msg(msg)
        result = dummy_comm.messages[0]["data"]["result"]
        assert len(result) > 0
        field_names = [field["name"] for field in result]
        assert "air_time" in field_names
        assert all("dtype" in field for field in result)

    def test_preview_object(self, connections_service: ConnectionsService):
        dummy_comm, comm_id = self._open_comm(connections_service)
        path = self._table_path()

        msg = _make_msg(params={"path": path}, method="preview_object", comm_id=comm_id)
        dummy_comm.handle_msg(msg)
        connections_service._kernel.data_explorer_service.shutdown()  # noqa: SLF001
        result = dummy_comm.messages[0]["data"]["result"]
        assert result is None


@pytest.mark.skipif(not HAS_SNOWFLAKE, reason="Snowflake not available")
class TestSnowflakeConnectionsService:
    DATABASE_NAME = "POSITRON_CONNECTIONS_PANE_TESTS"
    SCHEMA_NAME = "PUBLIC"
    TABLE_NAME = "FLIGHTS"

    def test_register_connection(self, connections_service: ConnectionsService):
        con = get_snowflake_connection()
        comm_id = connections_service.register_connection(con)
        assert comm_id in connections_service.comms

    @pytest.mark.parametrize(
        "path",
        [
            [],
            [{"kind": "database", "name": DATABASE_NAME}],
            [
                {"kind": "database", "name": DATABASE_NAME},
                {"kind": "schema", "name": SCHEMA_NAME},
            ],
        ],
    )
    def test_contains_data(self, connections_service: ConnectionsService, path):
        con = get_snowflake_connection()
        comm_id = connections_service.register_connection(con)

        dummy_comm = DummyComm(TARGET_NAME, comm_id=comm_id)
        connections_service.on_comm_open(dummy_comm)
        dummy_comm.messages.clear()

        msg = _make_msg(params={"path": path}, method="contains_data", comm_id=comm_id)
        dummy_comm.handle_msg(msg)
        result = dummy_comm.messages[0]["data"]["result"]
        assert result is False

    @pytest.mark.parametrize(
        ("path", "expected"),
        [
            ([], "data:image"),
            ([{"kind": "database", "name": DATABASE_NAME}], ""),
            (
                [
                    {"kind": "database", "name": DATABASE_NAME},
                    {"kind": "schema", "name": SCHEMA_NAME},
                ],
                "",
            ),
        ],
    )
    def test_get_icon(self, connections_service: ConnectionsService, path, expected):
        con = get_snowflake_connection()
        comm_id = connections_service.register_connection(con)

        dummy_comm = DummyComm(TARGET_NAME, comm_id=comm_id)
        connections_service.on_comm_open(dummy_comm)
        dummy_comm.messages.clear()

        msg = _make_msg(params={"path": path}, method="get_icon", comm_id=comm_id)
        dummy_comm.handle_msg(msg)
        result = dummy_comm.messages[0]["data"]["result"]
        if expected == "":
            assert result == expected
        else:
            assert expected in result

    @pytest.mark.parametrize(
        ("path", "expected_contains"),
        [
            ([], DATABASE_NAME),
            ([{"kind": "database", "name": DATABASE_NAME}], SCHEMA_NAME),
            (
                [
                    {"kind": "database", "name": DATABASE_NAME},
                    {"kind": "schema", "name": SCHEMA_NAME},
                ],
                TABLE_NAME,
            ),
        ],
    )
    def test_list_objects(self, connections_service: ConnectionsService, path, expected_contains):
        con = get_snowflake_connection()
        comm_id = connections_service.register_connection(con)

        dummy_comm = DummyComm(TARGET_NAME, comm_id=comm_id)
        connections_service.on_comm_open(dummy_comm)
        dummy_comm.messages.clear()

        msg = _make_msg(params={"path": path}, method="list_objects", comm_id=comm_id)
        dummy_comm.handle_msg(msg)
        result = dummy_comm.messages[0]["data"]["result"]

        # Check that expected item is in the results
        names = [item["name"] for item in result]
        assert expected_contains in names

    def test_list_fields(self, connections_service: ConnectionsService):
        con = get_snowflake_connection()
        comm_id = connections_service.register_connection(con)

        dummy_comm = DummyComm(TARGET_NAME, comm_id=comm_id)
        connections_service.on_comm_open(dummy_comm)
        dummy_comm.messages.clear()

        msg = _make_msg(
            params={
                "path": [
                    {"kind": "database", "name": self.DATABASE_NAME},
                    {"kind": "schema", "name": self.SCHEMA_NAME},
                    {"kind": "table", "name": self.TABLE_NAME},
                ]
            },
            method="list_fields",
            comm_id=comm_id,
        )
        dummy_comm.handle_msg(msg)
        result = dummy_comm.messages[0]["data"]["result"]
        assert len(result) == 19
        nms = [field["name"] for field in result]
        assert "AIR_TIME" in nms

    def test_preview_object(self, connections_service: ConnectionsService):
        con = get_snowflake_connection()
        comm_id = connections_service.register_connection(con)

        dummy_comm = DummyComm(TARGET_NAME, comm_id=comm_id)
        connections_service.on_comm_open(dummy_comm)
        dummy_comm.messages.clear()

        msg = _make_msg(
            params={
                "path": [
                    {"kind": "database", "name": self.DATABASE_NAME},
                    {"kind": "schema", "name": self.SCHEMA_NAME},
                    {"kind": "table", "name": self.TABLE_NAME},
                ]
            },
            method="preview_object",
            comm_id=comm_id,
        )
        dummy_comm.handle_msg(msg)
        # cleanup the data_explorer state, so we don't break its own tests
        connections_service._kernel.data_explorer_service.shutdown()  # noqa: SLF001
        result = dummy_comm.messages[0]["data"]["result"]
        assert result is None


class TestVariablePaneIntegration:
    @pytest.mark.parametrize("con", get_sqlite_connections())
    def test_open_then_delete(
        self,
        shell: PositronShell,
        connections_service: ConnectionsService,
        variables_comm: DummyComm,
        con,
    ):
        self._assign_variables(shell, variables_comm, x=con)
        path = self._view_in_connections_pane(variables_comm, ["x"])

        assert connections_service.path_to_comm_ids[path] is not None

        self._delete_variables(shell, variables_comm, ["x"])
        assert connections_service.path_to_comm_ids.get(path) is None

    @pytest.mark.parametrize("con", get_sqlite_connections())
    def test_open_update_variable(
        self,
        shell: PositronShell,
        connections_service: ConnectionsService,
        variables_comm: DummyComm,
        con,
    ):
        self._assign_variables(shell, variables_comm, x=con)
        path = self._view_in_connections_pane(variables_comm, ["x"])

        assert connections_service.path_to_comm_ids[path] is not None

        self._assign_variables(shell, variables_comm, x=1)
        assert connections_service.path_to_comm_ids.get(path) is None

    @pytest.mark.parametrize("con", get_sqlite_connections())
    def test_nested_variable(
        self,
        shell: PositronShell,
        connections_service: ConnectionsService,
        variables_comm: DummyComm,
        con,
    ):
        obj = {"y": con}
        self._assign_variables(shell, variables_comm, x=obj)
        path = self._view_in_connections_pane(variables_comm, ["x", "y"])

        assert connections_service.path_to_comm_ids[path] is not None
        assert connections_service.variable_has_active_connection("x")

    @pytest.mark.parametrize("con", get_sqlite_connections())
    def test_frontend_comm_closed(
        self,
        shell: PositronShell,
        connections_service: ConnectionsService,
        variables_comm: DummyComm,
        con,
    ):
        self._assign_variables(shell, variables_comm, x=con)
        path = self._view_in_connections_pane(variables_comm, ["x"])

        comm_id = connections_service.path_to_comm_ids[path]
        assert comm_id is not None

        connections_service.comms[comm_id].comm.handle_close({})

        assert connections_service.comms.get(comm_id) is None
        assert connections_service.path_to_comm_ids.get(path) is None

    @pytest.mark.skipif(not HAS_DUCKDB, reason="DuckDB not available")
    def test_duckdb_integration(
        self,
        shell: PositronShell,
        connections_service: ConnectionsService,
        variables_comm: DummyComm,
    ):
        con = get_duckdb_connection()
        self._assign_variables(shell, variables_comm, duck_con=con)
        path = self._view_in_connections_pane(variables_comm, ["duck_con"])

        assert connections_service.path_to_comm_ids[path] is not None
        assert connections_service.variable_has_active_connection("duck_con")

        # Test deleting DuckDB connection
        self._delete_variables(shell, variables_comm, ["duck_con"])
        assert connections_service.path_to_comm_ids.get(path) is None

    # TODO: reuse code from test_data_explorer.py
    def _assign_variables(self, shell: PositronShell, variables_comm: DummyComm, **variables):
        # A hack to make sure that change events are fired when we
        # manipulate user_ns
        shell.kernel.variables_service.snapshot_user_ns()
        shell.user_ns.update(**variables)
        shell.kernel.variables_service.poll_variables()
        variables_comm.messages.clear()

    def _delete_variables(self, shell: PositronShell, variables_comm: DummyComm, names):
        for nm in names:
            shell.run_cell(f"del {nm}")

        shell.kernel.variables_service.poll_variables()
        variables_comm.messages.clear()

    def _view_in_connections_pane(self, variables_comm: DummyComm, path):
        encoded_paths = [encode_access_key(p) for p in path]
        msg = _make_msg("view", {"path": encoded_paths}, comm_id="dummy_comm_id")
        variables_comm.handle_msg(msg)
        assert variables_comm.messages == [json_rpc_response({})]
        variables_comm.messages.clear()
        return tuple(encoded_paths)
