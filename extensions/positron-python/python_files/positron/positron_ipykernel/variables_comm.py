#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#

#
# AUTO-GENERATED from variables.json; do not edit.
#

# flake8: noqa

# For forward declarations
from __future__ import annotations

import enum
from typing import Any, List, Literal, Optional, Union

from ._vendor.pydantic import BaseModel, Field, StrictBool, StrictFloat, StrictInt, StrictStr


@enum.unique
class ClipboardFormatFormat(str, enum.Enum):
    """
    Possible values for Format in ClipboardFormat
    """

    TextHtml = "text/html"

    TextPlain = "text/plain"


@enum.unique
class VariableKind(str, enum.Enum):
    """
    Possible values for Kind in Variable
    """

    Boolean = "boolean"

    Bytes = "bytes"

    Class = "class"

    Collection = "collection"

    Empty = "empty"

    Function = "function"

    Map = "map"

    Number = "number"

    Other = "other"

    String = "string"

    Table = "table"

    Lazy = "lazy"

    Connection = "connection"


class VariableList(BaseModel):
    """
    A view containing a list of variables in the session.
    """

    variables: List[Variable] = Field(
        description="A list of variables in the session.",
    )

    length: StrictInt = Field(
        description="The total number of variables in the session. This may be greater than the number of variables in the 'variables' array if the array is truncated.",
    )

    version: Optional[StrictInt] = Field(
        default=None,
        description="The version of the view (incremented with each update)",
    )


class InspectedVariable(BaseModel):
    """
    An inspected variable.
    """

    children: List[Variable] = Field(
        description="The children of the inspected variable.",
    )

    length: StrictInt = Field(
        description="The total number of children. This may be greater than the number of children in the 'children' array if the array is truncated.",
    )


class FormattedVariable(BaseModel):
    """
    An object formatted for copying to the clipboard.
    """

    content: StrictStr = Field(
        description="The formatted content of the variable.",
    )


class Variable(BaseModel):
    """
    A single variable in the runtime.
    """

    access_key: StrictStr = Field(
        description="A key that uniquely identifies the variable within the runtime and can be used to access the variable in `inspect` requests",
    )

    display_name: StrictStr = Field(
        description="The name of the variable, formatted for display",
    )

    display_value: StrictStr = Field(
        description="A string representation of the variable's value, formatted for display and possibly truncated",
    )

    display_type: StrictStr = Field(
        description="The variable's type, formatted for display",
    )

    type_info: StrictStr = Field(
        description="Extended information about the variable's type",
    )

    size: StrictInt = Field(
        description="The size of the variable's value in bytes",
    )

    kind: VariableKind = Field(
        description="The kind of value the variable represents, such as 'string' or 'number'",
    )

    length: StrictInt = Field(
        description="The number of elements in the variable, if it is a collection",
    )

    has_children: StrictBool = Field(
        description="Whether the variable has child variables",
    )

    has_viewer: StrictBool = Field(
        description="True if there is a viewer available for this variable (i.e. the runtime can handle a 'view' request for this variable)",
    )

    is_truncated: StrictBool = Field(
        description="True if the 'value' field is a truncated representation of the variable's value",
    )

    updated_time: StrictInt = Field(
        description="The time the variable was created or updated, in milliseconds since the epoch, or 0 if unknown.",
    )


@enum.unique
class VariablesBackendRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the backend variables comm.
    """

    # List all variables
    List = "list"

    # Clear all variables
    Clear = "clear"

    # Deletes a set of named variables
    Delete = "delete"

    # Inspect a variable
    Inspect = "inspect"

    # Format for clipboard
    ClipboardFormat = "clipboard_format"

    # Request a viewer for a variable
    View = "view"


class ListRequest(BaseModel):
    """
    Returns a list of all the variables in the current session.
    """

    method: Literal[VariablesBackendRequest.List] = Field(
        description="The JSON-RPC method name (list)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class ClearParams(BaseModel):
    """
    Clears (deletes) all variables in the current session.
    """

    include_hidden_objects: StrictBool = Field(
        description="Whether to clear hidden objects in addition to normal variables",
    )


class ClearRequest(BaseModel):
    """
    Clears (deletes) all variables in the current session.
    """

    params: ClearParams = Field(
        description="Parameters to the Clear method",
    )

    method: Literal[VariablesBackendRequest.Clear] = Field(
        description="The JSON-RPC method name (clear)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class DeleteParams(BaseModel):
    """
    Deletes the named variables from the current session.
    """

    names: List[StrictStr] = Field(
        description="The names of the variables to delete.",
    )


class DeleteRequest(BaseModel):
    """
    Deletes the named variables from the current session.
    """

    params: DeleteParams = Field(
        description="Parameters to the Delete method",
    )

    method: Literal[VariablesBackendRequest.Delete] = Field(
        description="The JSON-RPC method name (delete)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class InspectParams(BaseModel):
    """
    Returns the children of a variable, as an array of variables.
    """

    path: List[StrictStr] = Field(
        description="The path to the variable to inspect, as an array of access keys.",
    )


class InspectRequest(BaseModel):
    """
    Returns the children of a variable, as an array of variables.
    """

    params: InspectParams = Field(
        description="Parameters to the Inspect method",
    )

    method: Literal[VariablesBackendRequest.Inspect] = Field(
        description="The JSON-RPC method name (inspect)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class ClipboardFormatParams(BaseModel):
    """
    Requests a formatted representation of a variable for copying to the
    clipboard.
    """

    path: List[StrictStr] = Field(
        description="The path to the variable to format, as an array of access keys.",
    )

    format: ClipboardFormatFormat = Field(
        description="The requested format for the variable, as a MIME type",
    )


class ClipboardFormatRequest(BaseModel):
    """
    Requests a formatted representation of a variable for copying to the
    clipboard.
    """

    params: ClipboardFormatParams = Field(
        description="Parameters to the ClipboardFormat method",
    )

    method: Literal[VariablesBackendRequest.ClipboardFormat] = Field(
        description="The JSON-RPC method name (clipboard_format)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class ViewParams(BaseModel):
    """
    Request that the runtime open a data viewer to display the data in a
    variable.
    """

    path: List[StrictStr] = Field(
        description="The path to the variable to view, as an array of access keys.",
    )


class ViewRequest(BaseModel):
    """
    Request that the runtime open a data viewer to display the data in a
    variable.
    """

    params: ViewParams = Field(
        description="Parameters to the View method",
    )

    method: Literal[VariablesBackendRequest.View] = Field(
        description="The JSON-RPC method name (view)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class VariablesBackendMessageContent(BaseModel):
    comm_id: str
    data: Union[
        ListRequest,
        ClearRequest,
        DeleteRequest,
        InspectRequest,
        ClipboardFormatRequest,
        ViewRequest,
    ] = Field(..., discriminator="method")


@enum.unique
class VariablesFrontendEvent(str, enum.Enum):
    """
    An enumeration of all the possible events that can be sent to the frontend variables comm.
    """

    # Update variables
    Update = "update"

    # Refresh variables
    Refresh = "refresh"


class UpdateParams(BaseModel):
    """
    Update variables
    """

    assigned: List[Variable] = Field(
        description="An array of variables that have been newly assigned.",
    )

    unevaluated: List[Variable] = Field(
        description="An array of variables that were not evaluated for value updates.",
    )

    removed: List[StrictStr] = Field(
        description="An array of variable names that have been removed.",
    )

    version: StrictInt = Field(
        description="The version of the view (incremented with each update), or 0 if the backend doesn't track versions.",
    )


class RefreshParams(BaseModel):
    """
    Refresh variables
    """

    variables: List[Variable] = Field(
        description="An array listing all the variables in the current session.",
    )

    length: StrictInt = Field(
        description="The number of variables in the current session.",
    )

    version: StrictInt = Field(
        description="The version of the view (incremented with each update), or 0 if the backend doesn't track versions.",
    )


VariableList.update_forward_refs()

InspectedVariable.update_forward_refs()

FormattedVariable.update_forward_refs()

Variable.update_forward_refs()

ListRequest.update_forward_refs()

ClearParams.update_forward_refs()

ClearRequest.update_forward_refs()

DeleteParams.update_forward_refs()

DeleteRequest.update_forward_refs()

InspectParams.update_forward_refs()

InspectRequest.update_forward_refs()

ClipboardFormatParams.update_forward_refs()

ClipboardFormatRequest.update_forward_refs()

ViewParams.update_forward_refs()

ViewRequest.update_forward_refs()

UpdateParams.update_forward_refs()

RefreshParams.update_forward_refs()
