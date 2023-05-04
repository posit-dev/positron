#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import enum
import logging
import types
from collections.abc import Iterable, Mapping, Sequence
from typing import Any, Optional

from .inspectors import get_inspector, MAX_ITEMS
from .utils import get_qualname


@enum.unique
class EnvironmentMessageType(str, enum.Enum):
    """
    Message types used in the positron.environment comm.
    """

    CLEAR = "clear"
    CLIPBOARD_FORMAT = "clipboard_format"
    DELETE = "delete"
    DETAILS = "details"
    ERROR = "error"
    FORMATTED_VARIABLE = "formatted_variable"
    INSPECT = "inspect"
    LIST = "list"
    REFRESH = "refresh"
    UPDATE = "update"
    VIEW = "view"


@enum.unique
class EnvironmentVariableKind(str, enum.Enum):
    """
    Categories of variables in the user's environment.
    """

    BOOLEAN = "boolean"
    BYTES = "bytes"
    COLLECTION = "collection"
    EMPTY = "empty"
    FUNCTION = "function"
    MAP = "map"
    NUMBER = "number"
    OTHER = "other"
    STRING = "string"
    TABLE = "table"


@enum.unique
class ClipboardFormat(str, enum.Enum):
    """
    Format styles for clipboard copy
    """

    HTML = "text/html"
    PLAIN = "text/plain"


# Note: classes below are derived from dict to satisfy ipykernel util method
# json_clean() which is used in comm message serialization
class EnvironmentVariable(dict):
    """
    Describes a variable in the user's environment.
    """

    def __init__(
        self,
        display_name: str,
        display_value: Any,
        kind: EnvironmentVariableKind = EnvironmentVariableKind.OTHER,
        display_type: Optional[str] = None,
        type_info: Optional[str] = None,
        access_key: Optional[str] = None,
        length: int = 0,
        size: Optional[int] = None,
        has_children: bool = False,
        has_viewer: bool = False,
        is_truncated: bool = False,
    ):
        self["display_name"] = display_name
        self["display_value"] = display_value
        if kind is not None:
            self["kind"] = getattr(EnvironmentVariableKind, kind.upper())
        self["display_type"] = display_type
        self["type_info"] = type_info
        self["access_key"] = access_key
        self["length"] = length
        self["size"] = size
        self["has_children"] = has_children
        self["has_viewer"] = has_viewer
        self["is_truncated"] = is_truncated


class EnvironmentMessage(dict):
    """
    Base message for the positron.environment comm.
    """

    def __init__(self, msg_type):
        self["msg_type"] = getattr(EnvironmentMessageType, msg_type.upper())


class EnvironmentMessageList(EnvironmentMessage):
    """
    Message 'list' type summarizes the variables in the user's environment.
    """

    def __init__(self, variables: list, length: Optional[int] = None):
        super().__init__(EnvironmentMessageType.LIST)
        self["variables"] = variables
        if length is None:
            length = len(variables)
        self["length"] = length


class EnvironmentMessageFormatted(EnvironmentMessage):
    """
    Message 'formatted_variable' type summarizes the variable
    in a text format suitable for copy and paste operations in
    the user's environment.
    """

    def __init__(self, clipboard_format: str, content: str):
        super().__init__(EnvironmentMessageType.FORMATTED_VARIABLE)
        self["format"] = clipboard_format
        self["content"] = content


class EnvironmentMessageDetails(EnvironmentMessage):
    """
    Message 'details' type summarizes the variables in the user's environment.
    """

    def __init__(self, path: Sequence, children: list, length: Optional[int] = None):
        super().__init__(EnvironmentMessageType.DETAILS)
        self["path"] = path
        self["children"] = children
        if length is None:
            length = len(children)
        self["length"] = length


class EnvironmentMessageUpdate(EnvironmentMessage):
    """
    Message 'update' type summarizes the variables that have changed in the
    user's environment since the last execution.
    """

    def __init__(self, assigned: list, removed: set):
        super().__init__(EnvironmentMessageType.UPDATE)
        self["assigned"] = assigned
        self["removed"] = removed


class EnvironmentMessageError(EnvironmentMessage):
    """
    Message 'error' type is used to report a problem to the client.
    """

    def __init__(self, message):
        super().__init__(EnvironmentMessageType.ERROR)
        self["message"] = message


class EnvironmentService:
    def __init__(self, kernel):  # noqa: F821
        self.kernel = kernel
        self.env_comm = None

    def on_comm_open(self, comm, open_msg) -> None:
        """
        Setup positron.environment comm to receive messages.
        """
        self.env_comm = comm
        comm.on_msg(self.receive_message)

        # Send summary of user environment on comm initialization
        self.send_list()

    def receive_message(self, msg) -> None:
        """
        Handle messages sent by the client to the positron.environment comm.
        """
        data = msg["content"]["data"]

        msgType = data.get("msg_type", None)
        if msgType == EnvironmentMessageType.INSPECT:
            path = data.get("path", None)
            self._inspect_var(path)

        elif msgType == EnvironmentMessageType.REFRESH:
            self.send_list()

        elif msgType == EnvironmentMessageType.VIEW:
            path = data.get("path", None)
            self._view_var(path)

        elif msgType == EnvironmentMessageType.CLIPBOARD_FORMAT:
            path = data.get("path", None)
            clipboard_format = data.get("format", ClipboardFormat.PLAIN)
            self._send_formatted_var(path, clipboard_format)

        elif msgType == EnvironmentMessageType.CLEAR:
            self._delete_all_vars(msg)

        elif msgType == EnvironmentMessageType.DELETE:
            names = data.get("names", [])
            self._delete_vars(names, msg)

        else:
            self._send_error(f"Unknown message type '{msgType}'")

    def send_update(self, assigned: dict, removed: set) -> None:
        # Ensure the number of changes does not exceed our maximum items
        if len(assigned) < MAX_ITEMS and len(removed) < MAX_ITEMS:
            self._send_update(assigned, removed)
        else:
            # Otherwise, just refresh the client state
            self.send_list()

    def send_list(self) -> None:
        """
        Sends a list message summarizing the variables of the current user session through the
        environment comm to the client.

        For example:
        {
            "data": {
                "msg_type": "list",
                "variables": [{
                    "display_name": "mygreeting",
                    "display_value": "Hello",
                    "kind": "string"
                }]
            }
            ...
        }
        """
        variables = self.kernel.get_filtered_vars()
        filtered_variables = self._summarize_variables(variables)

        msg = EnvironmentMessageList(filtered_variables)
        self._send_message(msg)

    def shutdown(self) -> None:
        if self.env_comm is not None:
            try:
                self.env_comm.close()
            except Exception:
                pass

    # -- Private Methods --

    def _send_message(self, msg: EnvironmentMessage) -> None:
        """
        Send a message through the environment comm to the client.
        """
        if self.env_comm is None:
            logging.warning("Cannot send message, environment comm is not open")
            return

        self.env_comm.send(msg)

    def _send_error(self, message: str) -> None:
        """
        Send an error message through the envirvonment comm to the client.

        For example:
        {
            "data": {
                "msg_type": "error",
                "message": "The error message"
            }
            ...
        }
        """
        msg = EnvironmentMessageError(message)
        self._send_message(msg)

    def _send_update(self, assigned: Mapping, removed: Iterable) -> None:
        """
        Sends the list of variables in the current user session through the environment comm
        to the client.

        For example:
        {
            "data": {
                "msg_type": "update",
                "assigned": [{
                    "display_name": "newvar1",
                    "display_value": "Hello",
                    "kind": "string"
                }],
                "removed": ["oldvar1", "oldvar2"]
            }
            ...
        }
        """
        # Filter out hidden assigned variables
        variables = self.kernel.get_filtered_vars(assigned)
        filtered_assigned = self._summarize_variables(variables)

        # Filter out hidden removed variables
        filtered_removed = self.kernel.get_filtered_var_names(removed)

        msg = EnvironmentMessageUpdate(filtered_assigned, filtered_removed)
        self._send_message(msg)

    def _delete_all_vars(self, parent) -> None:
        """
        Deletes all of the variables in the current user session.
        """
        self.kernel.delete_all_vars(parent)

    def _delete_vars(self, names: Iterable, parent) -> None:
        """
        Deletes the requested variables by name from the current user session.
        """
        if names is None:
            return

        assigned, removed = self.kernel.del_vars(names, parent)
        self._send_update(assigned, removed)

    def _inspect_var(self, path: Sequence) -> None:
        """
        Describes the variable at the requested path in the current user session.
        """
        if path is None:
            return

        is_known, value = self.kernel.find_var(path)

        if is_known:
            self._send_details(path, value)
        else:
            message = f"Cannot find variable at '{path}' to inspect"
            self._send_error(message)

    def _view_var(self, path: Sequence) -> None:
        """
        Opens a viewer comm for the variable at the requested path in the
        current user session.
        """
        try:
            self.kernel.view_var(path)
        except ValueError as error:
            self._send_error(str(error))

    def _send_formatted_var(
        self, path: Sequence, clipboard_format: ClipboardFormat = ClipboardFormat.PLAIN
    ) -> None:
        """
        Formats the variable at the requested path in the current user session
        using the requested clipboard format and sends the result through the
        environment comm to the client.
        """

        if path is None:
            return

        is_known, value = self.kernel.find_var(path)

        if is_known:
            content = self._format_value(value, clipboard_format)
            msg = EnvironmentMessageFormatted(clipboard_format, content)
            self._send_message(msg)
        else:
            message = f"Cannot find variable at '{path}' to format"
            self._send_error(message)

    def _send_details(self, path: Sequence, context: Any = None):
        """
        Sends a detailed list of children of the value (or just the value
        itself, if is a leaf node on the path) as a message through the
        environment comm to the client.

        For example:
        {
            "data": {
                "msg_type": "details",
                "path": ["myobject", "myproperty"],
                "children": [{
                    "display_name": "property1",
                    "display_value": "Hello",
                    "kind": "string",
                    "display_type": "str"
                },{
                    "display_name": "property2",
                    "display_value": "123",
                    "kind": "number"
                    "display_type": "int"
                }]
            }
            ...
        }
        """

        children = []
        inspector = get_inspector(context)
        if inspector is not None and inspector.has_children(context):
            children = inspector.summarize_children(context, self._summarize_variable)
        else:
            # Otherwise, treat as a simple value at given path
            summary = self._summarize_variable("", context)
            if summary is not None:
                children.append(summary)
            # TODO: Handle scalar objects with a specific message type

        msg = EnvironmentMessageDetails(path=path, children=children)
        self._send_message(msg)

    def _summarize_variables(self, variables: Mapping, max_items: int = MAX_ITEMS) -> list:
        summaries = []

        for key, value in variables.items():
            # Ensure the number of items summarized is within our
            # max limit
            if len(summaries) >= max_items:
                break

            summary = self._summarize_variable(key, value)
            if summary is not None:
                summaries.append(summary)

        return summaries

    def _summarize_variable(self, key, value) -> Optional[EnvironmentVariable]:
        # Hide module types for now
        if isinstance(value, types.ModuleType):
            return None

        display_name = str(key)

        try:
            # Use an inspector to summarize the value
            ins = get_inspector(value)

            kind_str = ins.get_kind(value)
            kind = getattr(EnvironmentVariableKind, kind_str.upper())
            display_value, is_truncated = ins.get_display_value(value)
            display_type = ins.get_display_type(value)
            type_info = ins.get_type_info(value)
            length = ins.get_length(value)
            size = ins.get_size(value)
            has_children = ins.has_children(value)
            has_viewer = ins.has_viewer(value)

            return EnvironmentVariable(
                display_name=display_name,
                display_value=display_value,
                display_type=display_type,
                kind=kind,
                type_info=type_info,
                access_key=display_name,
                length=length,
                size=size,
                has_children=has_children,
                has_viewer=has_viewer,
                is_truncated=is_truncated,
            )

        except Exception as err:
            logging.warning(err, exc_info=True)
            return EnvironmentVariable(
                display_name=display_name,
                display_value=get_qualname(value),
                kind=EnvironmentVariableKind.OTHER,
            )

    def _format_value(self, value, clipboard_format: ClipboardFormat) -> str:
        inspector = get_inspector(value)

        if clipboard_format == ClipboardFormat.HTML:
            return inspector.to_html(value)
        elif clipboard_format == ClipboardFormat.PLAIN:
            return inspector.to_tsv(value)
        else:
            return str(value)
