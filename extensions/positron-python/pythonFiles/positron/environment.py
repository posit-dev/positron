#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#
from __future__ import annotations

import enum
import logging
import types
from collections.abc import Iterable, Mapping
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Set

from comm.base_comm import BaseComm

from ._pydantic_compat import BaseModel, Field, validator

from .dataviewer import DataViewerService
from .inspectors import MAX_ITEMS, decode_access_key, get_inspector
from .utils import get_qualname

if TYPE_CHECKING:
    from .positron_ipkernel import PositronIPyKernel

logger = logging.getLogger(__name__)


# Synchronize the models below with:
#     src/vs/workbench/services/languageRuntime/common/languageRuntimeEnvironmentClient.ts


@enum.unique
class EnvironmentMessageTypeInput(str, enum.Enum):
    """
    The possible types of messages that can be sent to the language runtime as
    requests to the environment backend.
    """

    # A request to clear the environment
    clear = "clear"

    # A request to format the variable's content in a format suitable for the clipboard
    clipboard_format = "clipboard_format"

    # A request to delete a specific set of named variables
    delete = "delete"

    # A request to inspect a specific variable
    inspect = "inspect"

    # A request to send another List event
    refresh = "refresh"

    # A request to open a viewer for a specific variable
    view = "view"


@enum.unique
class EnvironmentMessageTypeOutput(str, enum.Enum):
    """
    Message types used in the positron.environment comm.
    """

    # A full list of all the variables and their values
    list = "list"

    # A partial update indicating the set of changes that have occurred since
    # the last update or list event.
    update = "update"

    # The details (children) of a specific variable
    details = "details"

    # The formatted content of a variable, suitable for placing on the clipboard
    formatted_variable = "formatted_variable"

    # A successful result of an RPC that doesn't otherwise return data.
    success = "success"

    # A processing error
    error = "error"


@enum.unique
class EnvironmentVariableValueKind(str, enum.Enum):
    """
    Represents the possible kinds of values in an environment.
    """

    # A boolean value
    boolean = "boolean"

    # A sequence of bytes or raw binary data
    bytes = "bytes"

    # A iterable collection of unnamed values, such as a list or array
    collection = "collection"

    # An empty, missing, null, or invalid value
    empty = "empty"

    # A function, method, closure, or other callable object
    function = "function"

    # A map, dictionary, named list, or associative array
    map = "map"

    # A number, such as an integer or floating-point value
    number = "number"

    # A value of an unknown or unspecified type
    other = "other"

    # A character string
    string = "string"

    # A table, dataframe, 2D matrix, or other two-dimensional data structure
    table = "table"


@enum.unique
class ClipboardFormat(str, enum.Enum):
    """
    Format styles for clipboard copy
    """

    html = "text/html"
    plain = "text/plain"


class EnvironmentVariable(BaseModel):
    """
    Represents a variable in a language runtime environment -- a value with a
    named identifier, not a system environment variable.

    This is the raw data format used to communicate with the language runtime.
    """

    access_key: Optional[str] = Field(
        default=None,
        description="""A key that uniquely identifies the variable within the current environment and
can be used to access the variable in `inspect` requests""",
    )

    display_name: str = Field(description="The name of the variable, formatted for display")

    display_value: Any = Field(
        description="A string representation of the variable's value formatted for display, possibly truncated"
    )

    display_type: Optional[str] = Field(
        default=None, description="The variable's type, formatted for display"
    )

    type_info: Optional[str] = Field(
        default=None, description="Extended information about the variable's type"
    )

    kind: EnvironmentVariableValueKind = Field(
        default=EnvironmentVariableValueKind.other,
        description="The kind of value the variable represents, such as 'string' or 'number'",
    )

    length: int = Field(
        default=0, description="The number of elements in the variable's value, if applicable"
    )

    size: Optional[int] = Field(
        default=None, description="The size of the variable's value, in bytes"
    )

    has_children: bool = Field(
        default=False, description="True if the variable contains other variables"
    )

    has_viewer: bool = Field(
        default=False,
        description="""True if there is a viewer available for the variable (i.e. the runtime
can handle a 'view' message for the variable)""",
    )

    is_truncated: bool = Field(
        default=False, description="True if the 'value' field was truncated to fit in the message"
    )


class EnvironmentMessageOutput(BaseModel):
    """
    A message used to receive data from the language runtime environment client.
    """

    msg_type: EnvironmentMessageTypeOutput

    class Config:
        fields = {"msg_type": {"const": True}}


class EnvironmentMessageList(EnvironmentMessageOutput):
    """
    A list of all the variables and their values.
    """

    variables: List[EnvironmentVariable] = Field(description="The list of variables")
    length: Optional[int] = Field(
        default=None,
        description="""The total number of variables known to the runtime. This may be greater
than the number of variables in the list if the list was truncated.""",
    )
    msg_type: EnvironmentMessageTypeOutput = EnvironmentMessageTypeOutput.list

    @validator("length", always=True)
    def default_length(cls, length: Optional[int], values: Dict[str, Any]) -> int:
        return len(values["variables"]) if length is None else length


class EnvironmentMessageFormattedVariable(EnvironmentMessageOutput):
    """
    Summarize the variable in a text format suitable for copy and paste operations in
    the user's environment.
    """

    format: ClipboardFormat
    content: str
    msg_type: EnvironmentMessageTypeOutput = EnvironmentMessageTypeOutput.formatted_variable


class EnvironmentMessageDetails(EnvironmentMessageOutput):
    """
    The details (children) of a specific variable.
    """

    path: List[str] = Field(description="The list of child variables")
    children: List[EnvironmentVariable]
    length: Optional[int] = Field(
        default=None,
        description="""The total number of child variables. This may be greater than the number
of variables in the list if the list was truncated.""",
    )
    msg_type: EnvironmentMessageTypeOutput = EnvironmentMessageTypeOutput.details

    @validator("length", always=True)
    def default_length(cls, length: Optional[int], values: Dict[str, Any]) -> int:
        return len(values["children"]) if length is None else length


class EnvironmentMessageUpdate(EnvironmentMessageOutput):
    """
    A partial update indicating the set of changes that have occurred since the
    last update or list event.
    """

    assigned: List[EnvironmentVariable]
    removed: Set[str]
    msg_type: EnvironmentMessageTypeOutput = EnvironmentMessageTypeOutput.update


class EnvironmentMessageError(EnvironmentMessageOutput):
    """
    Message 'error' type is used to report a problem to the client.
    """

    message: str
    msg_type: EnvironmentMessageTypeOutput = EnvironmentMessageTypeOutput.error


class EnvironmentService:
    def __init__(self, kernel: PositronIPyKernel, dataviewer_service: DataViewerService) -> None:
        self.kernel = kernel
        self.dataviewer_service = dataviewer_service

        self._comm: Optional[BaseComm] = None

    def on_comm_open(self, comm: BaseComm, msg: Dict[str, Any]) -> None:
        """
        Setup positron.environment comm to receive messages.
        """
        self._comm = comm
        comm.on_msg(self._receive_message)

        # Send summary of user environment on comm initialization
        self.send_list()

    def _receive_message(self, msg: Dict[str, Any]) -> None:
        """
        Handle messages received from the client via the positron.environment comm.

        Message Types:
            "clear"            - Clear all user variables in the environment
            "clipboard_format" - Format the variable at the requested path for the client clipboard
            "delete"           - Delete user variables in the environment by name
            "inspect"          - Inspect the user variable at the requested path
            "refresh"          - Refresh the list of user variables in the environment
            "view"             - Format the variable at the requested path for the data viewer
        """
        data = msg["content"]["data"]

        msg_type = data.get("msg_type", None)
        if msg_type == EnvironmentMessageTypeInput.refresh:
            self.send_list()

        elif msg_type == EnvironmentMessageTypeInput.clear:
            self._delete_all_vars(msg)

        elif msg_type == EnvironmentMessageTypeInput.delete:
            names = data.get("names", [])
            self._delete_vars(names, msg)

        elif msg_type == EnvironmentMessageTypeInput.inspect:
            path = data.get("path", None)
            self._inspect_var(path)

        elif msg_type == EnvironmentMessageTypeInput.clipboard_format:
            path = data.get("path", None)
            clipboard_format = data.get("format", ClipboardFormat.plain)
            self._send_formatted_var(path, clipboard_format)

        elif msg_type == EnvironmentMessageTypeInput.view:
            path = data.get("path", None)
            self._view_var(path)

        else:
            self._send_error(f"Unknown message type '{msg_type}'")

    def send_update(self, assigned: Mapping[str, Any], removed: Set[str]) -> None:
        """
        Sends the list of variables that have changed in the current user session through the
        environment comm to the client.
        """
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
        inspector = get_inspector(variables)
        filtered_variables = inspector.summarize_children(variables, _summarize_variable)

        msg = EnvironmentMessageList(variables=filtered_variables)
        self._send_message(msg)

    def shutdown(self) -> None:
        if self._comm is not None:
            try:
                self._comm.close()
            except Exception:
                pass

    # -- Private Methods --

    def _send_message(self, msg: EnvironmentMessageOutput) -> None:
        """
        Send a message through the environment comm to the client.
        """
        if self._comm is None:
            logger.warning("Cannot send message, environment comm is not open")
            return

        msg_dict = msg.dict()
        self._comm.send(msg_dict)

    def _send_error(self, error_message: str) -> None:
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
        msg = EnvironmentMessageError(message=error_message)
        self._send_message(msg)

    def _send_update(self, assigned: Mapping[str, Any], removed: Set[str]) -> None:
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
        inspector = get_inspector(variables)
        filtered_assigned = inspector.summarize_children(variables, _summarize_variable)

        # Filter out hidden removed variables
        filtered_removed = self.kernel.get_filtered_var_names(removed)

        if filtered_assigned or filtered_removed:
            msg = EnvironmentMessageUpdate(assigned=filtered_assigned, removed=filtered_removed)
            self._send_message(msg)

    def _delete_all_vars(self, parent: Dict[str, Any]) -> None:
        """
        Deletes all of the variables in the current user session.

        Args:
            parent:
                A dict providing the parent context for the response,
                e.g. the client message requesting the clear operation
        """
        self.kernel.delete_all_vars(parent)

    def _delete_vars(self, names: Iterable[str], parent: Dict[str, Any]) -> None:
        """
        Deletes the requested variables by name from the current user session.

        Args:
            names:
                A list of variable names to delete
            parent:
                A dict providing the parent context for the response,
                e.g. the client message requesting the delete operation
        """
        if names is None:
            return

        assigned, removed = self.kernel.delete_vars(names, parent)
        self._send_update(assigned, removed)

    def _inspect_var(self, path: List[str]) -> None:
        """
        Describes the variable at the requested path in the current user session.

        Args:
            path:
                A list of names describing the path to the variable.
        """
        if path is None:
            return

        is_known, value = self.kernel.find_var(path)
        if is_known:
            self._send_details(path, value)
        else:
            self._send_error(f"Cannot find variable at '{path}' to inspect")

    def _view_var(self, path: List[str]) -> None:
        """
        Opens a viewer comm for the variable at the requested path in the
        current user session.
        """
        if path is None:
            return

        is_known, value = self.kernel.find_var(path)
        if is_known:
            inspector = get_inspector(value)
            # Use the leaf segment to get the title
            access_key = path[-1]
            title = str(decode_access_key(access_key))
            dataset = inspector.to_dataset(value, title)
            self.dataviewer_service.register_dataset(dataset)
        else:
            self._send_error(f"Cannot find variable at '{path}' to view")

    def _send_formatted_var(
        self, path: List[str], clipboard_format: ClipboardFormat = ClipboardFormat.plain
    ) -> None:
        """
        Formats the variable at the requested path in the current user session
        using the requested clipboard format and sends the result through the
        environment comm to the client.

        Args:
            path:
                A list of names describing the path to the variable.
            clipboard_format:
                The format to use for the clipboard copy, described as a mime type.
                Defaults to "text/plain".
        """
        if path is None:
            return

        is_known, value = self.kernel.find_var(path)
        if is_known:
            content = _format_value(value, clipboard_format)
            msg = EnvironmentMessageFormattedVariable(format=clipboard_format, content=content)
            self._send_message(msg)
        else:
            self._send_error(f"Cannot find variable at '{path}' to format")

    def _send_details(self, path: List[str], value: Any = None):
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

        Args:
            path:
                A list of names describing the path to the variable.
            value:
                The variable's value to summarize.
        """

        children = []
        inspector = get_inspector(value)
        if inspector.has_children(value):
            children = inspector.summarize_children(value, _summarize_variable)
        else:
            # Otherwise, treat as a simple value at given path
            summary = _summarize_variable("", value)
            if summary is not None:
                children.append(summary)
            # TODO: Handle scalar objects with a specific message type

        msg = EnvironmentMessageDetails(path=path, children=children)
        self._send_message(msg)


def _summarize_variable(key: Any, value: Any) -> Optional[EnvironmentVariable]:
    """
    Summarizes the given variable into an EnvironmentVariable object.

    Args:
        key:
            The actual key of the variable in its parent object, used as an input to determine the
            variable's string access key.
        value:
            The variable's value.

    Returns:
        An EnvironmentVariable summary, or None if the variable should be skipped.
    """
    # Hide module types for now
    if isinstance(value, types.ModuleType):
        return None

    try:
        # Use an inspector to summarize the value
        ins = get_inspector(value)

        display_name = ins.get_display_name(key)
        kind_str = ins.get_kind(value)
        kind = EnvironmentVariableValueKind(kind_str)
        display_value, is_truncated = ins.get_display_value(value)
        display_type = ins.get_display_type(value)
        type_info = ins.get_type_info(value)
        access_key = ins.get_access_key(key)
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
            access_key=access_key,
            length=length,
            size=size,
            has_children=has_children,
            has_viewer=has_viewer,
            is_truncated=is_truncated,
        )

    except Exception as err:
        logger.warning(err, exc_info=True)
        return EnvironmentVariable(
            display_name=str(key),
            display_value=get_qualname(value),
            kind=EnvironmentVariableValueKind.other,
        )


def _format_value(value: Any, clipboard_format: ClipboardFormat) -> str:
    """
    Formats the given value using the requested clipboard format.
    """
    inspector = get_inspector(value)

    if clipboard_format == ClipboardFormat.html:
        return inspector.to_html(value)
    else:
        return inspector.to_plaintext(value)
