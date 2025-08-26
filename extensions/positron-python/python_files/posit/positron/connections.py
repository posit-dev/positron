#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
from __future__ import annotations

import contextlib
import logging
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

    from .positron_ipkernel import PositronIPyKernel


logger = logging.getLogger(__name__)


class ConnectionObjectInfo(TypedDict):
    icon: str | None
    contains: dict[str, ConnectionObjectInfo] | str | None


class ConnectionObject(TypedDict):
    name: str
    kind: str


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

    def preview_object(self, path: list[ObjectSchema]) -> tuple[Any, str | None]:
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
            self.handle_preview_object_request(connection, request)
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
        self, conn: Connection, request: PreviewObjectRequest
    ) -> None:
        res, sql_string = conn.preview_object(request.params.path)
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

    def preview_object(self, path: list[ObjectSchema]):
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
        return (
            pd.read_sql(
                sql_string,
                self.conn,
            ),
            f'# {table.name} = pd.read_sql("""{sql_string}""", conn) # where conn is your connection variable',
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

    def preview_object(self, path: list[ObjectSchema]):
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
        sql_string = f"""# table = sqlalchemy.Table(
        #    {table.name!r}, sqlalchemy.MetaData(), autoload_with=conn, schema={schema.name!r}
        # ) # where conn is your connection variable
        # {table.name} = pd.read_sql(sqlalchemy.sql.select(table), conn.connect())
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

    def preview_object(self, path: list[ObjectSchema]):
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
        return (
            self.conn.execute(query).df(),
            f"# {table.name} = conn.execute({query!r}).df() # where conn is your connection variable",
        )

    def list_object_types(self):
        return {
            "table": ConnectionObjectInfo({"contains": "data", "icon": None}),
            "view": ConnectionObjectInfo({"contains": "data", "icon": None}),
            "schema": ConnectionObjectInfo({"contains": None, "icon": None}),
        }

    def disconnect(self):
        self.conn.close()  # type: ignore
