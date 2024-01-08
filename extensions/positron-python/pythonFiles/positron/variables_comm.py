#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#

#
# AUTO-GENERATED from variables.json; do not edit.
#

# For forward declarations
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Dict, List, Union, Optional

JsonData = Union[Dict[str, "JsonData"], List["JsonData"], str, int, float, bool, None]


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

    Collection = "collection"

    Empty = "empty"

    Function = "function"

    Map = "map"

    Number = "number"

    Other = "other"

    String = "string"

    Table = "table"

    Lazy = "lazy"


@dataclass
class VariableList:
    """
    A view containing a list of variables in the session.
    """

    variables: List[Variable] = field(
        metadata={
            "description": "A list of variables in the session.",
        }
    )

    length: int = field(
        metadata={
            "description": "The total number of variables in the session. This may be greater than the number of variables in the 'variables' array if the array is truncated.",
        }
    )

    version: Optional[int] = field(
        metadata={
            "description": "The version of the view (incremented with each update)",
            "default": None,
        }
    )


@dataclass
class InspectedVariable:
    """
    An inspected variable.
    """

    children: List[Variable] = field(
        metadata={
            "description": "The children of the inspected variable.",
        }
    )

    length: int = field(
        metadata={
            "description": "The total number of children. This may be greater than the number of children in the 'children' array if the array is truncated.",
        }
    )


@dataclass
class FormattedVariable:
    """
    An object formatted for copying to the clipboard.
    """

    content: str = field(
        metadata={
            "description": "The formatted content of the variable.",
        }
    )


@dataclass
class Variable:
    """
    A single variable in the runtime.
    """

    access_key: str = field(
        metadata={
            "description": "A key that uniquely identifies the variable within the runtime and can be used to access the variable in `inspect` requests",
        }
    )

    display_name: str = field(
        metadata={
            "description": "The name of the variable, formatted for display",
        }
    )

    display_value: str = field(
        metadata={
            "description": "A string representation of the variable's value, formatted for display and possibly truncated",
        }
    )

    display_type: str = field(
        metadata={
            "description": "The variable's type, formatted for display",
        }
    )

    type_info: str = field(
        metadata={
            "description": "Extended information about the variable's type",
        }
    )

    size: int = field(
        metadata={
            "description": "The size of the variable's value in bytes",
        }
    )

    kind: VariableKind = field(
        metadata={
            "description": "The kind of value the variable represents, such as 'string' or 'number'",
        }
    )

    length: int = field(
        metadata={
            "description": "The number of elements in the variable, if it is a collection",
        }
    )

    has_children: bool = field(
        metadata={
            "description": "Whether the variable has child variables",
        }
    )

    has_viewer: bool = field(
        metadata={
            "description": "True if there is a viewer available for this variable (i.e. the runtime can handle a 'view' request for this variable)",
        }
    )

    is_truncated: bool = field(
        metadata={
            "description": "True if the 'value' field is a truncated representation of the variable's value",
        }
    )


@enum.unique
class VariablesRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the variables comm.
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


@dataclass
class ListRequest:
    """
    Returns a list of all the variables in the current session.
    """

    method: VariablesRequest = field(
        metadata={"description": "The JSON-RPC method name (list)"}, default=VariablesRequest.List
    )

    jsonrpc: str = field(metadata={"description": "The JSON-RPC version specifier"}, default="2.0")


@dataclass
class ClearParams:
    """
    Clears (deletes) all variables in the current session.
    """

    include_hidden_objects: bool = field(
        metadata={
            "description": "Whether to clear hidden objects in addition to normal variables",
        }
    )


@dataclass
class ClearRequest:
    """
    Clears (deletes) all variables in the current session.
    """

    def __post_init__(self):
        """Revive RPC parameters after initialization"""
        if isinstance(self.params, dict):
            self.params = ClearParams(**self.params)

    params: ClearParams = field(metadata={"description": "Parameters to the Clear method"})

    method: VariablesRequest = field(
        metadata={"description": "The JSON-RPC method name (clear)"}, default=VariablesRequest.Clear
    )

    jsonrpc: str = field(metadata={"description": "The JSON-RPC version specifier"}, default="2.0")


@dataclass
class DeleteParams:
    """
    Deletes the named variables from the current session.
    """

    names: List[str] = field(
        metadata={
            "description": "The names of the variables to delete.",
        }
    )


@dataclass
class DeleteRequest:
    """
    Deletes the named variables from the current session.
    """

    def __post_init__(self):
        """Revive RPC parameters after initialization"""
        if isinstance(self.params, dict):
            self.params = DeleteParams(**self.params)

    params: DeleteParams = field(metadata={"description": "Parameters to the Delete method"})

    method: VariablesRequest = field(
        metadata={"description": "The JSON-RPC method name (delete)"},
        default=VariablesRequest.Delete,
    )

    jsonrpc: str = field(metadata={"description": "The JSON-RPC version specifier"}, default="2.0")


@dataclass
class InspectParams:
    """
    Returns the children of a variable, as an array of variables.
    """

    path: List[str] = field(
        metadata={
            "description": "The path to the variable to inspect, as an array of access keys.",
        }
    )


@dataclass
class InspectRequest:
    """
    Returns the children of a variable, as an array of variables.
    """

    def __post_init__(self):
        """Revive RPC parameters after initialization"""
        if isinstance(self.params, dict):
            self.params = InspectParams(**self.params)

    params: InspectParams = field(metadata={"description": "Parameters to the Inspect method"})

    method: VariablesRequest = field(
        metadata={"description": "The JSON-RPC method name (inspect)"},
        default=VariablesRequest.Inspect,
    )

    jsonrpc: str = field(metadata={"description": "The JSON-RPC version specifier"}, default="2.0")


@dataclass
class ClipboardFormatParams:
    """
    Requests a formatted representation of a variable for copying to the
    clipboard.
    """

    path: List[str] = field(
        metadata={
            "description": "The path to the variable to format, as an array of access keys.",
        }
    )

    format: ClipboardFormatFormat = field(
        metadata={
            "description": "The requested format for the variable, as a MIME type",
        }
    )


@dataclass
class ClipboardFormatRequest:
    """
    Requests a formatted representation of a variable for copying to the
    clipboard.
    """

    def __post_init__(self):
        """Revive RPC parameters after initialization"""
        if isinstance(self.params, dict):
            self.params = ClipboardFormatParams(**self.params)

    params: ClipboardFormatParams = field(
        metadata={"description": "Parameters to the ClipboardFormat method"}
    )

    method: VariablesRequest = field(
        metadata={"description": "The JSON-RPC method name (clipboard_format)"},
        default=VariablesRequest.ClipboardFormat,
    )

    jsonrpc: str = field(metadata={"description": "The JSON-RPC version specifier"}, default="2.0")


@dataclass
class ViewParams:
    """
    Request that the runtime open a data viewer to display the data in a
    variable.
    """

    path: List[str] = field(
        metadata={
            "description": "The path to the variable to view, as an array of access keys.",
        }
    )


@dataclass
class ViewRequest:
    """
    Request that the runtime open a data viewer to display the data in a
    variable.
    """

    def __post_init__(self):
        """Revive RPC parameters after initialization"""
        if isinstance(self.params, dict):
            self.params = ViewParams(**self.params)

    params: ViewParams = field(metadata={"description": "Parameters to the View method"})

    method: VariablesRequest = field(
        metadata={"description": "The JSON-RPC method name (view)"}, default=VariablesRequest.View
    )

    jsonrpc: str = field(metadata={"description": "The JSON-RPC version specifier"}, default="2.0")


@enum.unique
class VariablesEvent(str, enum.Enum):
    """
    An enumeration of all the possible events that can be sent from the variables comm.
    """

    # Update variables
    Update = "update"

    # Refresh variables
    Refresh = "refresh"


@dataclass
class UpdateParams:
    """
    Update variables
    """

    assigned: List[Variable] = field(
        metadata={"description": "An array of variables that have been newly assigned."}
    )

    removed: List[str] = field(
        metadata={"description": "An array of variable names that have been removed."}
    )

    version: int = field(
        metadata={
            "description": "The version of the view (incremented with each update), or 0 if the backend doesn't track versions."
        }
    )


@dataclass
class RefreshParams:
    """
    Refresh variables
    """

    variables: List[Variable] = field(
        metadata={"description": "An array listing all the variables in the current session."}
    )

    length: int = field(metadata={"description": "The number of variables in the current session."})

    version: int = field(
        metadata={
            "description": "The version of the view (incremented with each update), or 0 if the backend doesn't track versions."
        }
    )
