#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
from __future__ import annotations

import contextlib
import json
import logging
import re
import uuid
from typing import TYPE_CHECKING, Any, Tuple, TypedDict

import comm

from .access_keys import decode_access_key, encode_access_key
from .connections_comm import (
    ConnectionsBackendMessageContent,
    ConnectionsFrontendEvent,
    ContainsDataRequest,
    GetIconRequest,
    GetMetadataRequest,
    ListFieldsRequest,
    ListObjectsRequest,
    MetadataSchema,
    ObjectSchema,
    PreviewObjectRequest,
)
from .positron_comm import CommMessage, JsonRpcErrorCode, PositronComm
from .utils import JsonData, JsonRecord, safe_isinstance

if TYPE_CHECKING:
    import sqlite3

    import sqlalchemy
    from comm.base_comm import BaseComm
    from typing_extensions import NotRequired

    from .positron_ipkernel import PositronIPyKernel


logger = logging.getLogger(__name__)


class ConnectionObjectInfo(TypedDict):
    icon: str | None
    contains: dict[str, ConnectionObjectInfo] | str | None


class ConnectionObject(TypedDict):
    name: str
    kind: str
    has_children: NotRequired[bool]


class ConnectionObjectFields(TypedDict):
    name: str
    dtype: str


class UnsupportedConnectionError(Exception):
    pass


PathKey = Tuple[str, ...]


class Connection:
    """
    Base class representing a connection to a data source.

    Attributes:
        type: The type of the connection as a free form string. It's used along with `host` to
            determine the uniqueness of a connection.
        host: The host of the connection as a free form string.
        display_name: The name of the connection to be displayed in the UI.
        icon: The path to an icon to be used by the UI.
        code: The code used to recreate the connection.
        conn: The connection object.
        actions: A list of actions to be displayed in the UI.
    """

    type: str
    host: str
    display_name: str | None = None
    icon: str | None = None
    code: str | None = None
    conn: Any = None
    actions: Any = None

    def disconnect(self) -> None:
        "Callback executed when the connection is closed in the UI."
        raise NotImplementedError

    def list_object_types(self) -> dict[str, ConnectionObjectInfo]:
        """
        Returns a dictionary of object types and their properties.

        We expect the `contains` to be the string `"data"` if the object
        contains data (eg is a table or a view). `contains` can also
        be a dictionary listing sub objects in the hirarchy in this same
        format, but this is currently not used.

        The `icon` property is the path to an icon to be used by the UI.
        """
        raise NotImplementedError

    def list_objects(self, path: list[ObjectSchema]) -> list[ConnectionObject]:
        """
        Returns the list of objects at the given path.

        The returned object is a list of dictionaries with the:
        - name: The name of the object.
        - kind: The kind of the object.

        Args:
            path: The path to the object.
        """
        raise NotImplementedError

    def list_fields(self, path: list[ObjectSchema]) -> list[ConnectionObjectFields]:
        """
        Returns the list of fields for the given object.

        The returned object is a list of dictionaries with the:
        - name: The name of the field.
        - dtype: The data type of the field.

        Args:
            path: The path to the object.
        """
        raise NotImplementedError

    def preview_object(
        self, path: list[ObjectSchema], var_name: str | None = None
    ) -> tuple[Any, str | None]:
        """
        Returns a small sample of the object's data for previewing.

        The returned object must be a pandas dataframe or other types of
        objects that can be previewed with Positron's Data Explorer.

        Args:
            path: The path to the object.

        Returns:
            A tuple containing:
            - The preview data (pandas dataframe or similar)
            - A strings representing the code to recreate the data
        """
        raise NotImplementedError

    def get_metadata(self) -> MetadataSchema:
        """
        Returns metadata about the connection.

        The metadata object must contain the following properties:
        - name: The name of the connection.
        - language_id: The language ID for the connection. Essentially just R or python.
        - host: The host of the connection.
        - type: The type of the connection.
        - code: The code used to recreate the connection.
        """
        return MetadataSchema(
            name=self.display_name or "Unnamed Connection",
            language_id="python",
            host=self.host,
            type=self.type,
            code=self.code,
        )


class ConnectionsService:
    """A service that manages connections to data sources."""

    def __init__(self, kernel: PositronIPyKernel, comm_target_name: str):
        self.comms: dict[str, PositronComm] = {}
        self.comm_id_to_connection: dict[str, Connection] = {}
        self._kernel = kernel
        self._comm_target_name = comm_target_name

        # Maps from variable path to set of comm_ids serving requests.
        # A variable can point to a single connection object in the pane.
        # But a comm_id can be shared by multiple variable paths.
        self.path_to_comm_ids: dict[PathKey, str] = {}

        # Mapping from comm_id to the corresponding variable path.
        # Multiple variables paths, might point to the same commm_id.
        self.comm_id_to_path: dict[str, set[PathKey]] = {}

    def register_connection(
        self,
        connection: Any,
        variable_path: list[str] | str | None = None,
        *,
        display_pane: bool = True,
    ) -> str:
        """
        Opens a connection to the given data source.

        Args:
            connection: A subclass of Connection implementing the
              necessary methods.
            variable_path: The variable path that points to the connection.
                If None, the connection is not associated with any variable.
            display_pane: Wether the Connection Pane view container should be
                displayed in the UI once the connection is registered.
        """
        if not isinstance(connection, Connection):
            connection = self._wrap_connection(connection)

        # check if there's already a connection registered with the same type and host
        # just like RStudio we use the `type` and `host` properties to identify the connection
        # and we don't allow multiple connections to the same data source.
        # https://github.com/rstudio/rstudio/blob/2344a0bf04657a13c36053eb04bcc47616a623dc/src/cpp/session/modules/SessionConnections.R#L52-L53
        for comm_id, conn in self.comm_id_to_connection.items():
            if conn.type == connection.type and conn.host == connection.host:
                logger.info(
                    "Connection to host '%s' of type '%s' already opened with comm_id '%s'",
                    conn.host,
                    conn.type,
                    comm_id,
                )
                self._register_variable_path(variable_path, comm_id)

                if display_pane:
                    self.comms[comm_id].send_event(ConnectionsFrontendEvent.Focus.value, {})

                return comm_id

        comm_id = str(uuid.uuid4())
        base_comm = comm.create_comm(
            target_name=self._comm_target_name,
            comm_id=comm_id,
            data={
                "name": connection.display_name,
                "language_id": "python",
                "host": connection.host,
                "type": connection.type,
                "code": connection.code,
            },
        )

        self._register_variable_path(variable_path, comm_id)
        self.comm_id_to_connection[comm_id] = connection
        self.on_comm_open(base_comm)

        if display_pane:
            self.comms[comm_id].send_event(ConnectionsFrontendEvent.Focus.value, {})

        return comm_id

    def _register_variable_path(self, variable_path: list[str] | str | None, comm_id: str) -> None:
        if variable_path is None:
            return

        if isinstance(variable_path, str):
            variable_path = [encode_access_key(variable_path)]

        if not isinstance(variable_path, list):
            raise ValueError(variable_path)

        key = tuple(variable_path)

        # a variable path can only point to a single connection, if it's already pointing
        # to a connection, we "close the connection" and replace it with the new one
        if key in self.path_to_comm_ids:
            # if the variable path already points to the same comm_id, we don't need to
            # perform any registration.
            if self.path_to_comm_ids[key] == comm_id:
                return
            self._unregister_variable_path(key)

        if comm_id in self.comm_id_to_path:
            self.comm_id_to_path[comm_id].add(key)
        else:
            self.comm_id_to_path[comm_id] = {key}

        self.path_to_comm_ids[key] = comm_id

    def _unregister_variable_path(self, variable_path: PathKey) -> None:
        comm_id = self.path_to_comm_ids.pop(variable_path)
        self.comm_id_to_path[comm_id].remove(variable_path)

        # if comm_id no longer points to any connection, we close the comm
        if not self.comm_id_to_path[comm_id]:
            del self.comm_id_to_path[comm_id]
            self._close_connection(comm_id)

    def on_comm_open(self, comm: BaseComm):
        comm_id = comm.comm_id
        comm.on_close(lambda _msg: self._on_comm_close(comm_id))
        connections_comm = PositronComm(comm)
        connections_comm.on_msg(self.handle_msg, ConnectionsBackendMessageContent)
        self.comms[comm_id] = connections_comm

    def _wrap_connection(self, obj: Any) -> Connection:
        # this check is redundant with the if branches below, but allows us to make
        # sure the `object_is_supported` method is always in sync with what we really
        # support in the connections pane.
        if not self.object_is_supported(obj):
            type_name = type(obj).__name__
            raise UnsupportedConnectionError(f"Unsupported connection type {type_name}")

        if safe_isinstance(obj, "sqlite3", "Connection"):
            return SQLite3Connection(obj)
        elif safe_isinstance(obj, "sqlalchemy", "Engine"):
            return SQLAlchemyConnection(obj)
        elif safe_isinstance(obj, "duckdb", "DuckDBPyConnection"):
            return DuckDBConnection(obj)
        elif safe_isinstance(obj, "snowflake.connector", "SnowflakeConnection"):
            return SnowflakeConnection(obj)
        elif safe_isinstance(obj, "databricks.sql.client", "Connection"):
            return DatabricksConnection(obj)
        else:
            type_name = type(obj).__name__
            raise UnsupportedConnectionError(f"Unsupported connection type {type(obj)}")

    def object_is_supported(self, obj: Any) -> bool:
        """Checks if an object is supported by the connections pane."""
        try:
            # This block might fail if for some reason 'Connection', 'Engine', or 'DuckDBPyConnection' are
            # not available in their modules.
            return (
                safe_isinstance(obj, "sqlite3", "Connection")
                or safe_isinstance(obj, "sqlalchemy", "Engine")
                or safe_isinstance(obj, "duckdb", "DuckDBPyConnection")
                or safe_isinstance(obj, "snowflake.connector", "SnowflakeConnection")
                or safe_isinstance(obj, "databricks.sql.client", "Connection")
            )
        except Exception as err:
            logger.error(f"Error checking supported {err}")
            return False

    def variable_has_active_connection(self, variable_name: str) -> bool:
        """Checks if the given variable path has an active connection."""
        return any(decode_access_key(path[0]) == variable_name for path in self.path_to_comm_ids)

    def handle_variable_updated(self, variable_name: str, value: Any) -> None:
        """Handles a variable being updated in the kernel."""
        variable_path = [encode_access_key(variable_name)]
        comm_id = self.path_to_comm_ids.get(tuple(variable_path))

        # no comm for this variable path
        if comm_id is None:
            return

        try:
            # registering a new connection with the same variable path is going to close the
            # variable path if the connections are different.
            # when handling a variable update we don't want to go and display the pane in the IDE
            self.register_connection(value, variable_path=variable_path, display_pane=False)
        except UnsupportedConnectionError:
            # if an unsupported connection error, then it means the variable
            # is no longer a connection, thus we unregister that variable path,
            # wich might close the comm if it points only to that path.
            self._unregister_variable_path(tuple(variable_path))
            return
        except Exception:
            # Most likely the object refers to a closed connection. In this case
            # we also close the connection.
            self._unregister_variable_path(tuple(variable_path))
            return

    def handle_variable_deleted(self, variable_name: str) -> None:
        """Handles a variable being deleted in the kernel."""
        # copy the keys, as we might modify the dict in the loop
        paths = set(self.path_to_comm_ids.keys())
        for path in paths:
            key = decode_access_key(path[0])
            if key == variable_name:
                self._unregister_variable_path(path)

    def _on_comm_close(self, comm_id: str):
        """Handles front-end initiated close requests."""
        paths: set[PathKey] = set(self.comm_id_to_path.get(comm_id, set()))

        if not paths:
            # id the connection is not associated with any variable path, we close it
            # otherwise we need to check if other variables point to the same comm_id
            # before deleting.
            self._close_connection(comm_id)
            return

        for path in paths:
            self._unregister_variable_path(path)

        # this allows the variable pane to no longer display the 'view' action for a
        # connection that has been closed.
        self._kernel.variables_service.send_refresh_event()

    def _close_connection(self, comm_id: str):
        try:
            # calling disconnect can fail if the connection has already been closed or
            # if it's called from a different thread.
            # however, this shound't be fatal as we won't use it anymore in the connections
            # pane.
            self.comm_id_to_connection[comm_id].disconnect()
        except Exception as err:
            logger.warning(err, exc_info=True)

        try:
            self.comms[comm_id].close()
        except Exception as err:
            logger.warning(err, exc_info=True)

        del self.comms[comm_id]
        del self.comm_id_to_connection[comm_id]

    def shutdown(self):
        """Closes all comms and runs the `disconnect` callback."""
        for comm_id in list(self.comms.keys()):
            self._close_connection(comm_id)

        self.comms = {}  # implicitly deleting comms
        self.comm_id_to_connection = {}

    def handle_msg(
        self, msg: CommMessage[ConnectionsBackendMessageContent], raw_msg: JsonRecord
    ) -> None:
        """Handles messages from the frontend."""
        try:
            return self._handle_msg(msg, raw_msg)
        except Exception as err:
            # Any exception when handling messages is forwarded to the frontend which
            # will display an error message in the UI if fatal.

            try:
                comm_id = msg.content.comm_id
            except AttributeError:
                logger.error(
                    "Failed to process positron.connection request. No comm_id found in the message."
                )
                return None

            logger.warning(err, exc_info=True)
            self.comms[comm_id].send_error(
                JsonRpcErrorCode.INTERNAL_ERROR,
                f"Failed process positron.connection request: {err}",
            )

    def _handle_msg(
        self, msg: CommMessage[ConnectionsBackendMessageContent], _raw_msg: JsonRecord
    ) -> None:
        comm_id = msg.content.comm_id
        request = msg.content.data
        connection = self.comm_id_to_connection[comm_id]
        comm = self.comms[comm_id]

        result: JsonData = None
        if isinstance(request, ContainsDataRequest):
            result = self.handle_contains_data_request(connection, request)
        elif isinstance(request, ListObjectsRequest):
            # both list_objects_request and list_fields_request return list of
            # TypedDict objects that only contain strings. But pyright is not
            # able to infer that.
            result = self.handle_list_objects_request(connection, request)  # type: ignore
        elif isinstance(request, ListFieldsRequest):
            result = self.handle_list_fields_request(connection, request)  # type: ignore
        elif isinstance(request, GetIconRequest):
            result = self.handle_get_icon_request(connection, request)
        elif isinstance(request, PreviewObjectRequest):
            self.handle_preview_object_request(connection, request, comm_id)
            result = None
        elif isinstance(request, GetMetadataRequest):
            result = self.handle_get_metadata_request(connection, request)  # type: ignore
        else:
            raise NotImplementedError(f"Unhandled request: {request}")

        comm.send_result(result)

    def handle_contains_data_request(self, conn: Connection, request: ContainsDataRequest) -> bool:
        path = request.params.path
        if len(path) == 0:
            return False

        object_types: dict[str, Any] = conn.list_object_types()
        try:
            contains = object_types[path[-1].kind].get("contains", "not_data")
        except KeyError:
            contains = "not_data"
        return isinstance(contains, str) and contains == "data"

    def handle_get_icon_request(self, conn: Connection, request: GetIconRequest) -> str:
        path = request.params.path

        icon = None
        if len(path) == 0:
            icon = getattr(conn, "icon", None)
        else:
            object_types: dict[str, Any] = conn.list_object_types()
            with contextlib.suppress(KeyError):
                icon = object_types[path[-1].kind].get("icon", None)

        if icon is None:
            return ""
        return icon

    def handle_list_objects_request(
        self, conn: Connection, request: ListObjectsRequest
    ) -> list[ConnectionObject]:
        return conn.list_objects(request.params.path)

    def handle_list_fields_request(
        self, conn: Connection, request: ListFieldsRequest
    ) -> list[ConnectionObjectFields]:
        return conn.list_fields(request.params.path)

    def handle_preview_object_request(
        self, conn: Connection, request: PreviewObjectRequest, comm_id: str
    ) -> None:
        # Get variable name if available
        var_name = None
        if comm_id in self.comm_id_to_path:
            # Get the first path (variable name)
            path_key = next(iter(self.comm_id_to_path[comm_id]))
            if path_key and len(path_key) > 0:
                # Decode the variable name from the path
                var_name = decode_access_key(path_key[0])

        res, sql_string = conn.preview_object(request.params.path, var_name)
        title = request.params.path[-1].name

        self._kernel.data_explorer_service.register_table(res, title, sql_string=sql_string)

    def handle_get_metadata_request(
        self, conn: Connection, _request: GetMetadataRequest
    ) -> MetadataSchema:
        return conn.get_metadata()


class SQLite3Connection(Connection):
    """Support for sqlite3 connections to databases."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.display_name = "SQLite Connection"
        self.host = self._find_path(conn)
        self.type = "SQLite"
        self.code = (
            f"import sqlite3\nconn = sqlite3.connect({self.host!r})\n%connection_show conn\n"
        )

    def _find_path(self, conn: sqlite3.Connection):
        """
        Find the path to the database file or the in-memory database.

        The path is used as the `host` property and is important to indentify
        a unique sqlite3 connection.
        """
        cursor = conn.cursor()
        cursor.execute("PRAGMA database_list;")
        # this returns a tuple containing row_number, databasename and filepath
        row = cursor.fetchone()
        return row[2]

    def list_objects(self, path: list[ObjectSchema]):
        if len(path) == 0:
            # we are at the root of the database, thus we return the list of attached 'databases'
            # in general there's only `main` and `temp` but it seems users can attach other
            # dbs to the connection
            res = self.conn.cursor().execute("PRAGMA database_list;")
            schemas: list[ConnectionObject] = []
            for _, name, _ in res.fetchall():
                schemas.append(ConnectionObject({"name": name, "kind": "schema"}))
            return schemas

        if len(path) == 1:
            # we must have a schema on the path. and we return the list of tables and views
            # in that schema
            schema = path[0]
            if schema.kind != "schema":
                raise ValueError(
                    f"Invalid path. Expected it to include a schema, but got '{schema.kind}'",
                    f"Path: {path}",
                )

            # https://www.sqlite.org/schematab.html
            res = self.conn.cursor().execute(
                f"""
                SELECT name, type FROM {schema.name}.sqlite_schema WHERE type IN ('table', 'view');
                """
            )

            tables: list[ConnectionObject] = []
            for name, kind in res.fetchall():
                # We drop the internal schema objects as defined in:
                # https://www.sqlite.org/fileformat.html#internal_schema_objects
                # ie, objects that start with `sqlite_`
                if name.startswith("sqlite_"):
                    continue
                tables.append(ConnectionObject({"name": name, "kind": kind}))

            return tables

        # there is no additional hierarchies in SQLite databases. If we get to this point
        # it means the path is invalid.
        raise ValueError(f"Path length must be at most 1, but got {len(path)}. Path: {path}")

    def list_fields(self, path: list[ObjectSchema]):
        if len(path) != 2:
            raise ValueError(f"Path length must be 2, but got {len(path)}. Path: {path}")

        schema, table = path
        if schema.kind != "schema" or table.kind not in ["table", "view"]:
            raise ValueError(
                "Path must include a schema and a table/view in this order.", f"Path: {path}"
            )

        # https://www.sqlite.org/pragma.html#pragma_table_info
        res = self.conn.cursor().execute(f"PRAGMA {schema.name}.table_info({table.name});")
        fields: list[ConnectionObjectFields] = []
        for _, name, dtype, _, _, _ in res.fetchall():
            fields.append(ConnectionObjectFields({"name": name, "dtype": dtype}))

        return fields

    def disconnect(self):
        self.conn.close()

    def preview_object(self, path: list[ObjectSchema], var_name: str | None = None):
        try:
            import pandas as pd
        except ImportError as e:
            raise ModuleNotFoundError("Pandas is required for previewing SQLite tables.") from e

        if len(path) != 2:
            raise ValueError(f"Path length must be 2, but got {len(path)}. Path: {path}")

        schema, table = path
        if schema.kind != "schema" or table.kind not in ["table", "view"]:
            raise ValueError(
                "Path must include a schema and a table/view in this order.", f"Path: {path}"
            )

        sql_string = f"SELECT * FROM {schema.name}.{table.name} LIMIT 1000;"
        var_name = var_name or "conn"
        return (
            pd.read_sql(
                sql_string,
                self.conn,
            ),
            f'# {table.name} = pd.read_sql("""{sql_string}""", {var_name}) # where {var_name} is your connection variable',
        )

    def list_object_types(self):
        return {
            "table": ConnectionObjectInfo({"contains": "data", "icon": None}),
            "view": ConnectionObjectInfo({"contains": "data", "icon": None}),
            "schema": ConnectionObjectInfo({"contains": None, "icon": None}),
            "database": ConnectionObjectInfo({"contains": None, "icon": None}),
        }


class SQLAlchemyConnection(Connection):
    """Support for SQLAlchemy connections to databases."""

    def __init__(self, conn: sqlalchemy.Engine):
        self.conn = conn
        self.display_name = f"SQLAlchemy ({conn.name})"
        self.host = conn.url.render_as_string(hide_password=False)
        self.type = "SQLAlchemy"
        self.code = (
            "import sqlalchemy\n"
            f"engine = sqlalchemy.create_engine({self.host!r})\n"
            "%connection_show engine\n"
        )

    def list_objects(self, path: list[ObjectSchema]):
        try:
            import sqlalchemy
        except ImportError as e:
            raise ModuleNotFoundError(
                "SQLAlchemy is required for listing objects in SQLAlchemy connections."
            ) from e

        if len(path) == 0:
            # we at the root of the database so we return the list of schemas
            schemas = sqlalchemy.inspect(self.conn).get_schema_names()
            return [ConnectionObject({"name": name, "kind": "schema"}) for name in schemas]

        if len(path) == 1:
            # we must have a schema on the path. and we return the list of tables and views
            # in that schema
            schema = path[0]
            if schema.kind != "schema":
                raise ValueError(
                    f"Invalid path. Expected it to include a schema, but got '{schema.kind}'",
                    f"Path: {path}",
                )

            tables = sqlalchemy.inspect(self.conn).get_table_names(schema.name)
            views = sqlalchemy.inspect(self.conn).get_view_names(schema.name)
            return [ConnectionObject({"name": name, "kind": "table"}) for name in tables] + [
                ConnectionObject({"name": name, "kind": "view"}) for name in views
            ]

        raise ValueError(f"Path length must be at most 1, but got {len(path)}. Path: {path}")

    def list_fields(self, path: list[ObjectSchema]):
        try:
            import sqlalchemy
        except ImportError as e:
            raise ModuleNotFoundError(
                "SQLAlchemy is required for listing fields in SQLAlchemy connections."
            ) from e

        self._check_table_path(path)

        schema, table = path
        fields = sqlalchemy.inspect(self.conn).get_columns(
            schema_name=schema.name, table_name=table.name
        )
        return [
            ConnectionObjectFields({"name": field["name"], "dtype": str(field["type"])})
            for field in fields
        ]

    def list_object_types(self):
        return {
            "table": ConnectionObjectInfo({"contains": "data", "icon": None}),
            "view": ConnectionObjectInfo({"contains": "data", "icon": None}),
            "schema": ConnectionObjectInfo({"contains": None, "icon": None}),
            "database": ConnectionObjectInfo({"contains": None, "icon": None}),
        }

    def preview_object(self, path: list[ObjectSchema], var_name: str | None = None):
        try:
            import sqlalchemy
        except ImportError as e:
            raise ModuleNotFoundError(
                "SQLAlchemy is required for previewing objects in SQLAlchemy connections."
            ) from e

        try:
            import pandas as pd
        except ImportError as e:
            raise ModuleNotFoundError("Pandas is required for previewing SQLAlchemy tables.") from e

        self._check_table_path(path)
        schema, table = path

        table = sqlalchemy.Table(
            table.name, sqlalchemy.MetaData(), autoload_with=self.conn, schema=schema.name
        )
        stmt = sqlalchemy.sql.select(table).limit(1000)
        var_name = var_name or "conn"
        sql_string = f"""# table = sqlalchemy.Table(
        #    {table.name!r}, sqlalchemy.MetaData(), autoload_with={var_name}, schema={schema.name!r}
        # ) # where {var_name} is your connection variable
        # {table.name} = pd.read_sql(sqlalchemy.sql.select(table), {var_name}.connect())
        """
        # using conn.connect() is safer then using the conn directly and is also supported
        # with older pandas versions such as 1.5
        return pd.read_sql(stmt, self.conn.connect()), sql_string

    def disconnect(self):
        self.conn.dispose()

    def _check_table_path(self, path: list[ObjectSchema]):
        if len(path) != 2:
            raise ValueError(
                f"Invalid path. Length path ({len(path)}) expected to be 2.", f"Path: {path}"
            )

        schema, table = path
        if schema.kind != "schema" or table.kind not in ["table", "view"]:
            raise ValueError(
                "Invalid path. Expected path to contain a schema and a table/view.",
                f"But got schema.kind={schema.kind} and table.kind={table.kind}",
            )


class DuckDBConnection(Connection):
    """Support for DuckDB connections to databases."""

    def __init__(self, conn: Any):
        self.conn = conn
        self.icon = "data:image/png;base64,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"

        db_list = conn.execute("PRAGMA database_list;").fetchall()
        databases = ", ".join([row[1] for row in db_list])

        self.host = db_list[0][2]  # pragma database_list returns (seq, name, file)
        if self.host == "" or self.host is None:
            self.host = ":memory:"

        self.display_name = f"DuckDB ({databases})"
        self.type = "DuckDB"

        # DuckDB allows attaching other databases, thus we can't really get to the exact same
        # state. But we can at least show how to connect to the initial database.
        self.code = (
            f"import duckdb\nconn = duckdb.connect(database={self.host!r})\n%connection_show conn\n"
        )

    def list_objects(self, path: list[ObjectSchema]):
        if len(path) == 0:
            # we are at the root of the connection. DuckDB allows a connection to attach to multiple
            # databases. so we return a list of 'catalogs'.
            res = self.conn.execute(
                "SELECT DISTINCT catalog_name FROM information_schema.schemata WHERE catalog_name NOT IN ('system', 'temp');"
            )

            return [
                ConnectionObject({"name": name, "kind": "catalog"}) for (name,) in res.fetchall()
            ]

        if len(path) == 1:
            # We must have a catalog on the path, and we return the list of schemas in that catalog.
            catalog = path[0]
            if catalog.kind != "catalog":
                raise ValueError(
                    f"Invalid path. Expected it to include a catalog, but got '{catalog.kind}'",
                    f"Path: {path}",
                )

            res = self.conn.execute(
                """
                SELECT DISTINCT schema_name FROM information_schema.schemata
                WHERE catalog_name = ?;
                """,
                (catalog.name,),
            )

            return [
                ConnectionObject({"name": name, "kind": "schema"}) for (name,) in res.fetchall()
            ]

        if len(path) == 2:
            # Query for tables and views in the catalog/ schema
            catalog, schema = path
            if catalog.kind != "catalog" or schema.kind != "schema":
                raise ValueError(
                    "Path must include a catalog and a schema in this order.", f"Path: {path}"
                )

            res = self.conn.execute(
                """
                SELECT table_name, table_type
                FROM information_schema.tables
                WHERE table_schema = ? AND table_catalog = ?
                """,
                (schema.name, catalog.name),
            )

            tables: list[ConnectionObject] = []
            for name, table_type in res.fetchall():
                # Convert DuckDB table types to our standard types
                kind = "view" if table_type == "VIEW" else "table"
                tables.append(ConnectionObject({"name": name, "kind": kind}))

            return tables

        # DuckDB doesn't have deeper hierarchies. If we get to this point
        # it means the path is invalid.
        raise ValueError(f"Path length must be at most 2, but got {len(path)}. Path: {path}")

    def list_fields(self, path: list[ObjectSchema]):
        if len(path) != 3:
            raise ValueError(f"Path length must be 3, but got {len(path)}. Path: {path}")

        catalog, schema, table = path
        if (
            schema.kind != "schema"
            or table.kind not in ["table", "view"]
            or catalog.kind != "catalog"
        ):
            raise ValueError(
                "Path must include a catalog, a schema and a table/view in this order.",
                f"Path: {path}",
            )

        # Query for column information
        res = self.conn.execute(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = ? AND table_catalog = ?
            ORDER BY ordinal_position;
            """,
            (schema.name, table.name, catalog.name),
        )

        return [
            ConnectionObjectFields({"name": name, "dtype": dtype}) for name, dtype in res.fetchall()
        ]

    def preview_object(self, path: list[ObjectSchema], var_name: str | None = None):
        if len(path) != 3:
            raise ValueError(f"Path length must be 3, but got {len(path)}. Path: {path}")

        catalog, schema, table = path
        if (
            schema.kind != "schema"
            or table.kind not in ["table", "view"]
            or catalog.kind != "catalog"
        ):
            raise ValueError(
                "Path must include a catalog, a schema and a table/view in this order.",
                f"Path: {path}",
            )

        # Use DuckDB's native pandas integration via .df() method
        query = f'SELECT * FROM "{catalog.name}"."{schema.name}"."{table.name}" LIMIT 1000'
        var_name = var_name or "conn"
        return (
            self.conn.execute(query).df(),
            f"# {table.name} = {var_name}.execute({query!r}).df() # where {var_name} is your connection variable",
        )

    def list_object_types(self):
        return {
            "table": ConnectionObjectInfo({"contains": "data", "icon": None}),
            "view": ConnectionObjectInfo({"contains": "data", "icon": None}),
            "schema": ConnectionObjectInfo({"contains": None, "icon": None}),
        }

    def disconnect(self):
        self.conn.close()  # type: ignore


class SnowflakeConnection(Connection):
    """Support for Snowflake Connection connections to databases."""

    def __init__(self, conn: Any):
        self.conn = conn
        self.icon = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTYxLjA2MzIgMjguMjk2NEw1My43Mzg1IDMyLjQzOTVMNjEuMDYzMiAzNi41ODI1QzYyLjkyNTUgMzcuNjMwNSA2My41NDYyIDM5Ljk0NTggNjIuNDc4NSA0MS43NDkyQzYxLjQxMDkgNDMuNTUyNyA1OS4wNTIgNDQuMTYxOSA1Ny4xODk4IDQzLjEzODRMNDQuMDU0OCAzNS43Mjk2QzQzLjE4NTggMzUuMjQyMSA0Mi41NjUxIDM0LjQ2MjMgNDIuMjkxOSAzMy41ODQ5QzQyLjE2NzggMzMuMTcwNiA0Mi4wOTMzIDMyLjc1NjMgNDIuMTE4MSAzMi4zNjYzQzQyLjExODEgMzIuMDczOSA0Mi4xNjc4IDMxLjc4MTQgNDIuMjQyMyAzMS40NjQ2QzQyLjUxNTQgMzAuNTM4NSA0My4xMTEzIDI5LjcwOTkgNDQuMDMgMjkuMTk4MUw1Ny4xNjUgMjEuNzg5M0M1OS4wMDI0IDIwLjc0MTMgNjEuMzg2IDIxLjM3NSA2Mi40NTM3IDIzLjE3ODVDNjMuNTIxNCAyNC45ODE5IDYyLjkwMDYgMjcuMjk3MiA2MS4wMzg0IDI4LjM0NTFMNjEuMDYzMiAyOC4yOTY0Wk01NC4xMTA5IDQ4LjM3ODFMNDAuOTc2IDQwLjk2OTNDNDAuMjgwNyA0MC41Nzk0IDM5LjQ4NjIgNDAuNDA4OCAzOC43NDEzIDQwLjQ4MTlDMzYuNzMwMSA0MC42MjgxIDM1LjE2NTggNDIuMjYxIDM1LjE2NTggNDQuMjM1MVY1OS4wNTI3QzM1LjE2NTggNjEuMTQ4NiAzNi44NzkxIDYyLjgzMDIgMzkuMDM5MiA2Mi44MzAyQzQxLjE5OTQgNjIuODMwMiA0Mi45MTI3IDYxLjE0ODYgNDIuOTEyNyA1OS4wNTI3VjUwLjc2NjVMNTAuMjYyMyA1NC45MDk2QzUyLjA5OTcgNTUuOTU3NSA1NC40ODM0IDU1LjM0ODMgNTUuNTUxIDUzLjU0NDhDNTYuNjE4NyA1MS43NDEzIDU1Ljk5OCA0OS40MjYxIDU0LjEzNTcgNDguMzc4MUg1NC4xMTA5Wk0zOC45NjQ4IDMzLjkwMTdMMzMuNTAyMiAzOS4yMzlDMzMuMzUzMiAzOS4zODUyIDMzLjA1NTMgMzkuNTMxNCAzMi44MDcgMzkuNTMxNEgzMS4xOTNDMzAuOTY5NiAzOS41MzE0IDMwLjY3MTYgMzkuNDA5NiAzMC40OTc4IDM5LjIzOUwyNS4wMzUzIDMzLjkwMTdDMjQuODg2MyAzMy43NTU1IDI0Ljc2MjEgMzMuNDM4NyAyNC43NjIxIDMzLjI0MzdWMzEuNjg0QzI0Ljc2MjEgMzEuNDY0NiAyNC44ODYzIDMxLjE3MjIgMjUuMDM1MyAzMS4wMDE2TDMwLjQ5NzggMjUuNjY0M0MzMC42NDY4IDI1LjUxODEgMzAuOTY5NiAyNS4zOTYyIDMxLjE5MyAyNS4zOTYySDMyLjgwN0MzMy4wMzA0IDI1LjM5NjIgMzMuMzI4NCAyNS41MTgxIDMzLjUwMjIgMjUuNjY0M0wzOC45NjQ4IDMxLjAwMTZDMzkuMTEzNyAzMS4xNDc4IDM5LjIzNzkgMzEuNDY0NiAzOS4yMzc5IDMxLjY4NFYzMy4yNDM3QzM5LjIzNzkgMzMuNDYzMSAzOS4xMTM3IDMzLjc1NTUgMzguOTY0OCAzMy45MDE3Wk0zNC41OTQ3IDMyLjQxNTFDMzQuNTk0NyAzMi4xOTU4IDM0LjQ3MDYgMzEuOTAzMyAzNC4yOTY4IDMxLjczMjdMMzIuNzA3NiAzMC4xOTczQzMyLjU1ODcgMzAuMDUxMSAzMi4yMzU5IDI5LjkyOTIgMzIuMDEyNCAyOS45MjkySDMxLjkzNzlDMzEuNzE0NSAyOS45MjkyIDMxLjQxNjUgMzAuMDUxMSAzMS4yNjc1IDMwLjE5NzNMMjkuNjc4NCAzMS43MzI3QzI5LjUyOTQgMzEuOTAzMyAyOS40MDUzIDMyLjE5NTggMjkuNDA1MyAzMi40MTUxVjMyLjQ2MzhDMjkuNDA1MyAzMi42ODMyIDI5LjUyOTQgMzIuOTc1NiAyOS42Nzg0IDMzLjEyMTlMMzEuMjY3NSAzNC42NTcyQzMxLjQxNjUgMzQuODAzNSAzMS43MzkzIDM0LjkyNTMgMzEuOTM3OSAzNC45MjUzSDMyLjAxMjRDMzIuMjM1OSAzNC45MjUzIDMyLjUzMzggMzQuODAzNSAzMi43MDc2IDM0LjY1NzJMMzQuMjk2OCAzMy4xMjE5QzM0LjQ0NTcgMzIuOTc1NiAzNC41OTQ3IDMyLjY1ODggMzQuNTk0NyAzMi40NjM4VjMyLjQxNTFaTTkuODg5MDkgMTYuNDc2NEwyMy4wMjQgMjMuODg1MkMyMy43MTkzIDI0LjI3NTIgMjQuNTEzOCAyNC40NDU4IDI1LjI1ODcgMjQuMzcyNkMyNy4yNjk5IDI0LjIyNjQgMjguODM0MiAyMi41OTM2IDI4LjgzNDIgMjAuNTk1MVY1Ljc3NzUxQzI4LjgzNDIgMy43MDU5NyAyNy4wOTYxIDIgMjQuOTYwOCAyQzIyLjgyNTQgMiAyMS4wODczIDMuNjgxNiAyMS4wODczIDUuNzc3NTFWMTQuMDYzN0wxMy43Mzc3IDkuOTIwNkMxMS45MDAzIDguODcyNjQgOS41NDE0NyA5LjUwNjI5IDguNDQ4OTcgMTEuMzA5N0M3LjM4MTI4IDEzLjExMzIgOC4wMDIwMyAxNS40Mjg1IDkuODY0MjYgMTYuNDc2NEg5Ljg4OTA5Wk0zOC43NDEzIDI0LjM5N0MzOS40ODYyIDI0LjQ0NTggNDAuMjgwNyAyNC4yOTk1IDQwLjk3NiAyMy45MDk2TDU0LjExMDkgMTYuNTAwOEM1NS45NzMxIDE1LjQ1MjggNTYuNTkzOSAxMy4xMzc2IDU1LjUyNjIgMTEuMzM0MUM1NC40NTg1IDkuNTMwNjYgNTIuMDk5NyA4LjkyMTM4IDUwLjIzNzUgOS45NDQ5N0w0Mi44ODc5IDE0LjA4OFY1LjgwMTg5QzQyLjg4NzkgMy43MzAzNCA0MS4xNDk4IDIuMDI0MzcgMzkuMDE0NCAyLjAyNDM3QzM2Ljg3OTEgMi4wMjQzNyAzNS4xNDEgMy43MDU5NyAzNS4xNDEgNS44MDE4OVYyMC42MTk1QzM1LjE0MSAyMi42MTc5IDM2LjcwNTIgMjQuMjUwOCAzOC43MTY1IDI0LjM5N0gzOC43NDEzWk0yNS4yODM2IDQwLjQ4MTlDMjQuNTM4NyA0MC40MDg4IDIzLjc0NDEgNDAuNTc5NCAyMy4wNDg5IDQwLjk2OTNMOS45MTM5MiA0OC4zNzgxQzguMDc2NTIgNDkuNDI2MSA3LjQzMDk1IDUxLjc0MTMgOC40OTg2MyA1My41NDQ4QzkuNTY2MzEgNTUuMzQ4MyAxMS45MjUxIDU1Ljk1NzUgMTMuNzg3NCA1NC45MDk2TDIxLjEzNyA1MC43NjY1VjU5LjA1MjdDMjEuMTM3IDYxLjE0ODYgMjIuODc1MSA2Mi44MzAyIDI1LjAxMDQgNjIuODMwMkMyNy4xNDU4IDYyLjgzMDIgMjguODgzOSA2MS4xNDg2IDI4Ljg4MzkgNTkuMDUyN1Y0NC4yMzUxQzI4Ljg4MzkgNDIuMjM2NiAyNy4yOTQ4IDQwLjYwMzggMjUuMzA4NCA0MC40ODE5SDI1LjI4MzZaTTIxLjcwODEgMzMuNTYwNUMyMS44MzIyIDMzLjE0NjIgMjEuODgxOSAzMi43MzE5IDIxLjg4MTkgMzIuMzQyQzIxLjg4MTkgMzIuMDQ5NSAyMS44MzIyIDMxLjc1NzEgMjEuNzMyOSAzMS40NDAzQzIxLjQ4NDYgMzAuNTE0MSAyMC44NjM4IDI5LjY4NTUgMTkuOTQ1MSAyOS4xNzM3TDYuODEwMiAyMS43NjQ5QzQuOTQ3OTcgMjAuNzE3IDIuNTg5MTQgMjEuMzUwNiAxLjUyMTQ2IDIzLjE1NDFDMC40NTM3NzcgMjQuOTU3NSAxLjA3NDUzIDI3LjI3MjggMi45MzY3NiAyOC4zMjA4TDEwLjI2MTUgMzIuNDYzOEwyLjkzNjc2IDM2LjYwNjlDMS4wNzQ1MyAzNy42NTQ5IDAuNDUzNzc3IDM5Ljk3MDEgMS41MjE0NiA0MS43NzM2QzIuNTg5MTQgNDMuNTc3IDQuOTQ3OTcgNDQuMTg2MyA2LjgxMDIgNDMuMTYyN0wxOS45NDUxIDM1Ljc1MzlDMjAuODM5IDM1LjI2NjUgMjEuNDM0OSAzNC40ODY2IDIxLjcwODEgMzMuNjA5M1YzMy41NjA1WiIgZmlsbD0iIzI5QjVFOCIvPgo8L3N2Zz4K"

        try:
            cursor = conn.cursor()
            cursor.execute("SELECT CURRENT_ACCOUNT()")
            self.host = cursor.fetchone()[0]
        except Exception:
            self.host = "<unknown>"

        self.display_name = f"Snowflake ({self.host})"
        self.type = "Snowflake"
        self.code = self._make_code()

    def list_objects(self, path: list[ObjectSchema]):
        if len(path) == 0:
            res = self.conn.cursor().execute("SHOW DATABASES;")
            return [
                ConnectionObject({"name": row[1], "kind": "database"}) for row in res.fetchall()
            ]

        if len(path) == 1:
            database = path[0]
            res = self.conn.cursor().execute(f"SHOW SCHEMAS in DATABASE {database.name}")
            return [ConnectionObject({"name": row[1], "kind": "schema"}) for row in res.fetchall()]

        if len(path) == 2:
            database, schema = path
            tables = self.conn.cursor().execute(
                f"SHOW TABLES in SCHEMA {database.name}.{schema.name}"
            )
            views = self.conn.cursor().execute(
                f"SHOW VIEWS in SCHEMA {database.name}.{schema.name}"
            )
            return [
                ConnectionObject({"name": row[1], "kind": "table"}) for row in tables.fetchall()
            ] + [ConnectionObject({"name": row[1], "kind": "view"}) for row in views.fetchall()]

        raise ValueError(f"Path length must be at most 2, but got {len(path)}. Path: {path}")

    def list_fields(self, path):
        if len(path) != 3:
            raise ValueError(f"Path length must be 3, but got {len(path)}. Path: {path}")

        database, schema, table = path

        res = self.conn.cursor().execute(
            f"SHOW COLUMNS IN {database.name}.{schema.name}.{table.name}"
        )
        return [
            ConnectionObjectFields({"name": row[2], "dtype": json.loads(row[3])["type"]})
            for row in res.fetchall()
        ]

    def preview_object(self, path, var_name: str | None = None):
        if len(path) != 3:
            raise ValueError(f"Path length must be 3, but got {len(path)}. Path: {path}")

        database, schema, table = path

        query = f'SELECT * FROM "{database.name}"."{schema.name}"."{table.name}" LIMIT 1000;'
        var_name = var_name or "conn"
        preview = self.conn.cursor().execute(query).fetch_pandas_all()
        sql = (
            f"# {table.name} = {var_name}.execute({query!r}).df() # where {var_name} is your connection variable",
        )
        return preview, sql

    def list_object_types(self):
        return {
            "database": ConnectionObjectInfo({"contains": None, "icon": None}),
            "table": ConnectionObjectInfo({"contains": "data", "icon": None}),
            "view": ConnectionObjectInfo({"contains": "data", "icon": None}),
            "schema": ConnectionObjectInfo({"contains": None, "icon": None}),
        }

    def disconnect(self):
        self.conn.close()  # type: ignore

    def _make_code(self):
        args = ["account", "authenticator", "host", "user", "password", "port"]
        code = "import snowflake.connector\ncon = snowflake.connector.connect(\n"
        for arg in args:
            val = getattr(self.conn, f"_{arg}")
            if val is not None:
                val = repr(val)
                code += f"    {arg}={val},\n"
        code += ")\n"
        return code


class DatabricksConnection(Connection):
    """Support for Databricks connections to databases."""

    HOST_SUFFIX_RE = re.compile(r"\.(?:cloud\.)?databricks\.com$", re.IGNORECASE)

    def __init__(self, conn: Any):
        self.conn = conn

        # try conn.host
        host = getattr(conn, "host", None)
        if host is None:
            # fallback to conn.session.host
            host = getattr(getattr(conn, "session", None), "host", None)
        if host is None:
            host = "<unknown>"
        self.host = str(host)

        self.display_name = f"Databricks ({self.HOST_SUFFIX_RE.sub('', self.host, count=1)})"
        self.type = "Databricks"
        self.code = self._make_code()

        self.icon = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjMzMSIgdmlld0JveD0iMCAwIDMwMCAzMzEiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0yODMuOTIzIDEzNi40NDlMMTUwLjE0NCAyMTMuNjI0TDYuODg5OTUgMTMxLjE2OEwwIDEzNC45ODJWMTk0Ljg0NEwxNTAuMTQ0IDI4MS4xMTVMMjgzLjkyMyAyMDQuMjM0VjIzNS45MjZMMTUwLjE0NCAzMTMuMUw2Ljg4OTk1IDIzMC42NDRMMCAyMzQuNDU4VjI0NC43MjlMMTUwLjE0NCAzMzFMMzAwIDI0NC43MjlWMTg0Ljg2N0wyOTMuMTEgMTgxLjA1MkwxNTAuMTQ0IDI2My4yMTVMMTYuMDc2NiAxODYuMzM0VjE1NC42NDNMMTUwLjE0NCAyMzEuNTI0TDMwMCAxNDUuMjUzVjg2LjI3MTNMMjkyLjUzNiA4MS44Njk3TDE1MC4xNDQgMTYzLjczOUwyMi45NjY1IDkwLjk2NjNMMTUwLjE0NCAxNy44OTk4TDI1NC42NDEgNzguMDU1TDI2My44MjggNzIuNzczVjY1LjQzNzFMMTUwLjE0NCAwTDAgODYuMjcxM1Y5NS42NjEzTDE1MC4xNDQgMTgxLjkzM0wyODMuOTIzIDEwNC43NThWMTM2LjQ0OVoiIGZpbGw9IiNGRjM2MjEiLz4KPC9zdmc+Cg=="

    def disconnect(self):
        with contextlib.suppress(Exception):
            self.conn.close()

    def list_object_types(self):
        return {
            "catalog": ConnectionObjectInfo({"contains": None, "icon": None}),
            "schema": ConnectionObjectInfo({"contains": None, "icon": None}),
            "table": ConnectionObjectInfo({"contains": "data", "icon": None}),
            "view": ConnectionObjectInfo({"contains": "data", "icon": None}),
            # TODO: Volumes are like tables, but they can't be inspected further.
            # Maybe we can support it?
            # To nicely support it we need to expand the connections pane contract
            # to allow objects that can't be previewed or inspected further.
            # Maybe a `has_children` method can be added in a backward compatible way.
            "volume": ConnectionObjectInfo({"contains": None, "icon": None}),
        }

    def list_objects(self, path: list[ObjectSchema]):
        if len(path) == 0:
            rows = self._query("SHOW CATALOGS;")
            return [ConnectionObject({"name": row["catalog"], "kind": "catalog"}) for row in rows]

        if len(path) == 1:
            catalog = path[0]
            if catalog.kind != "catalog":
                raise ValueError("Expected catalog on path position 0.", f"Path: {path}")
            catalog_ident = self._qualify(catalog.name)
            rows = self._query(f"SHOW SCHEMAS IN {catalog_ident};")
            return [
                ConnectionObject(
                    {
                        "name": row["databaseName"],
                        "kind": "schema",
                    }
                )
                for row in rows
            ]

        if len(path) == 2:
            catalog, schema = path
            if catalog.kind != "catalog" or schema.kind != "schema":
                raise ValueError(
                    "Expected catalog and schema objects at positions 0 and 1.", f"Path: {path}"
                )
            location = f"{self._qualify(catalog.name)}.{self._qualify(schema.name)}"

            tables = self._query(f"SHOW TABLES IN {location};")
            tables = [
                ConnectionObject(
                    {
                        "name": row["tableName"],
                        "kind": "table",
                    }
                )
                for row in tables
            ]

            try:
                volumes = self._query(f"SHOW VOLUMES IN {location};")
                volumes = [
                    ConnectionObject(
                        {
                            "name": row["volume_name"],
                            "kind": "volume",
                            "has_children": False,
                        }
                    )
                    for row in volumes
                ]
            except Exception:
                volumes = []

            return tables + volumes

        raise ValueError(f"Path length must be at most 2, but got {len(path)}. Path: {path}")

    def list_fields(self, path: list[ObjectSchema]):
        if len(path) != 3:
            raise ValueError(f"Path length must be 3, but got {len(path)}. Path: {path}")

        catalog, schema, table = path
        if (
            catalog.kind != "catalog"
            or schema.kind != "schema"
            or table.kind not in ("table", "view")
        ):
            raise ValueError(
                "Expected catalog, schema, and table/view kinds in the path.",
                f"Path: {path}",
            )

        identifier = ".".join(
            [self._qualify(catalog.name), self._qualify(schema.name), self._qualify(table.name)]
        )
        rows = self._query(f"DESCRIBE TABLE {identifier};")
        return [
            ConnectionObjectFields(
                {
                    "name": row["col_name"],
                    "dtype": row["data_type"],
                }
            )
            for row in rows
        ]

    def preview_object(self, path: list[ObjectSchema], var_name: str | None = None):
        if len(path) != 3:
            raise ValueError(f"Path length must be 3, but got {len(path)}. Path: {path}")

        catalog, schema, table = path
        if (
            catalog.kind != "catalog"
            or schema.kind != "schema"
            or table.kind not in ("table", "view")
        ):
            raise ValueError(
                "Expected catalog, schema, and table/view kinds in the path.",
                f"Path: {path}",
            )

        identifier = ".".join(
            [self._qualify(catalog.name), self._qualify(schema.name), self._qualify(table.name)]
        )
        sql = f"SELECT * FROM {identifier} LIMIT 1000;"

        with self.conn.cursor() as cursor:
            cursor.execute(sql)
            frame = cursor.fetchall_arrow().to_pandas()
        var_name = var_name or "conn"
        return frame, (
            f"with {var_name}.cursor() as cursor:"
            f"    cursor.execute({sql!r})"
            f"    {table.name} = cursor.fetchall_arrow().to_pandas()"
        )

    def _query(self, sql: str) -> list[dict[str, Any]]:
        with self.conn.cursor() as cursor:
            cursor.execute(sql)
            rows = cursor.fetchall()
            description = cursor.description or []
        columns = [col[0] for col in description]
        return [dict(zip(columns, row)) for row in rows]

    def _qualify(self, identifier: str) -> str:
        escaped = identifier.replace("`", "``")
        return f"`{escaped}`"

    def _make_code(self) -> str:
        try:
            hostname = str(self.conn.session.http_client.config.hostname)
        except AttributeError:
            hostname = "<hostname>"

        try:
            http_path = str(self.conn.session.http_path)
        except AttributeError:
            http_path = "<http_path>"

        return (
            "from databricks import sql\n"
            "con = sql.connect(\n"
            f"    server_hostname = '{hostname}',\n"
            f"    http_path       = '{http_path}'\n"
            ")\n"
            "%connection_show con\n"
        )
