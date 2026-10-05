#
# Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

#
# AUTO-GENERATED from object_explorer.json; do not edit.
#

# flake8: noqa

# For forward declarations
from __future__ import annotations

import enum
from typing import Any, List, Literal, Optional, Union

from ._vendor.pydantic import BaseModel, Field, StrictBool, StrictFloat, StrictInt, StrictStr


@enum.unique
class ObjectNodeKind(str, enum.Enum):
    """
    Possible values for Kind in ObjectNode
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


@enum.unique
class SearchRowMatchKind(str, enum.Enum):
    """
    Possible values for MatchKind in SearchRow
    """

    Ancestor = "ancestor"

    Name = "name"

    Value = "value"

    NameAndValue = "name_and_value"


class ObjectExplorerState(BaseModel):
    """
    The state of an object explorer
    """

    title: StrictStr = Field(
        description="Title for the editor tab, usually the variable name or expression that was viewed",
    )

    connected: StrictBool = Field(
        description="False when the explored object no longer exists; the frontend shows a disconnected state",
    )

    error_message: Optional[StrictStr] = Field(
        default=None,
        description="Optional message explaining why the explorer is disconnected",
    )


class ChildrenResult(BaseModel):
    """
    A page of child nodes
    """

    children: List[ObjectNode] = Field(
        description="The requested page of children, in the object's natural order",
    )

    total: StrictInt = Field(
        description="Total number of children the parent has (may exceed the number returned)",
    )


class SearchResult(BaseModel):
    """
    Search results
    """

    rows: List[SearchRow] = Field(
        description="Matches and their ancestors in pre-order",
    )

    total_matches: StrictInt = Field(
        description="Number of matching nodes in 'rows'",
    )

    truncated: StrictBool = Field(
        description="True if the search stopped early because max_results or the node budget was reached",
    )


class FormattedValue(BaseModel):
    """
    A value formatted for the clipboard
    """

    content: StrictStr = Field(
        description="The formatted value",
    )


class ObjectNode(BaseModel):
    """
    One node in the explored object
    """

    access_key: StrictStr = Field(
        description="The path segment that selects this node within its parent; same semantics as the variables comm",
    )

    display_name: StrictStr = Field(
        description="The node's name (key, index, slot, or attribute), formatted for display",
    )

    display_type: StrictStr = Field(
        description="The node's type, formatted for display using the same formatter as the variables comm",
    )

    display_value: StrictStr = Field(
        description="The node's value, formatted for display and possibly truncated, using the same formatter as the variables comm",
    )

    kind: ObjectNodeKind = Field(
        description="The kind of value, using the same vocabulary as the variables comm",
    )

    length: StrictInt = Field(
        description="The number of children or elements, if known; 0 otherwise",
    )

    has_children: StrictBool = Field(
        description="Whether get_children would return anything for this node",
    )

    is_truncated: StrictBool = Field(
        description="True if display_value is a truncated representation",
    )

    is_cycle: StrictBool = Field(
        description="True if this node is the same object as one of its ancestors; such nodes never report children",
    )

    accessor: Optional[StrictStr] = Field(
        default=None,
        description="A language expression that evaluates to this node's value. Absent when no expression exists.",
    )


class SearchRow(BaseModel):
    """
    A row in a search result: a match or an ancestor of a match
    """

    path: List[StrictStr] = Field(
        description="Access keys from the root to this node",
    )

    node: ObjectNode = Field(
        description="The node at this path",
    )

    match_kind: SearchRowMatchKind = Field(
        description="Which field matched; 'ancestor' for ancestors included only for context",
    )


@enum.unique
class ObjectExplorerBackendRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the backend object_explorer comm.
    """

    # Get the explorer state
    GetState = "get_state"

    # Get the root node
    GetRoot = "get_root"

    # Get one page of a node's children
    GetChildren = "get_children"

    # Search names and values
    Search = "search"

    # Format a node's full value for the clipboard
    FormatValue = "format_value"

    # Open a full object explorer for an inline explorer
    OpenObjectExplorer = "open_object_explorer"


class GetStateRequest(BaseModel):
    """
    Returns the title and connection state of the explored object. Used on
    first open and when reconnecting to an existing comm.
    """

    method: Literal[ObjectExplorerBackendRequest.GetState] = Field(
        description="The JSON-RPC method name (get_state)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class GetRootRequest(BaseModel):
    """
    Returns the node describing the explored object itself (path []).
    """

    method: Literal[ObjectExplorerBackendRequest.GetRoot] = Field(
        description="The JSON-RPC method name (get_root)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class GetChildrenParams(BaseModel):
    """
    Returns up to 'limit' children of the node at 'path', starting at
    child index 'start'. Never descends more than one level.
    """

    path: List[StrictStr] = Field(
        description="Access keys from the root to the parent node; [] is the root",
    )

    start: StrictInt = Field(
        description="Zero-based index of the first child to return",
    )

    limit: StrictInt = Field(
        description="Maximum number of children to return",
    )


class GetChildrenRequest(BaseModel):
    """
    Returns up to 'limit' children of the node at 'path', starting at
    child index 'start'. Never descends more than one level.
    """

    params: GetChildrenParams = Field(
        description="Parameters to the GetChildren method",
    )

    method: Literal[ObjectExplorerBackendRequest.GetChildren] = Field(
        description="The JSON-RPC method name (get_children)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class SearchParams(BaseModel):
    """
    Depth-first, case-insensitive substring search over node display
    names, and over the display values of leaves (nodes that are neither
    containers nor cycles), bounded by max_depth and an internal node
    budget. Returns matches and every ancestor of a match, in pre-order,
    so the frontend can render the results as a tree.
    """

    query: StrictStr = Field(
        description="The text to search for",
    )

    max_depth: StrictInt = Field(
        description="Maximum depth below the root to descend (root children are depth 1)",
    )

    max_results: StrictInt = Field(
        description="Maximum number of matching nodes to return",
    )


class SearchRequest(BaseModel):
    """
    Depth-first, case-insensitive substring search over node display
    names, and over the display values of leaves (nodes that are neither
    containers nor cycles), bounded by max_depth and an internal node
    budget. Returns matches and every ancestor of a match, in pre-order,
    so the frontend can render the results as a tree.
    """

    params: SearchParams = Field(
        description="Parameters to the Search method",
    )

    method: Literal[ObjectExplorerBackendRequest.Search] = Field(
        description="The JSON-RPC method name (search)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class FormatValueParams(BaseModel):
    """
    Returns the complete (untruncated, within reason) plain-text
    representation of the node at 'path'.
    """

    path: List[StrictStr] = Field(
        description="Access keys from the root to the node",
    )


class FormatValueRequest(BaseModel):
    """
    Returns the complete (untruncated, within reason) plain-text
    representation of the node at 'path'.
    """

    params: FormatValueParams = Field(
        description="Parameters to the FormatValue method",
    )

    method: Literal[ObjectExplorerBackendRequest.FormatValue] = Field(
        description="The JSON-RPC method name (format_value)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class OpenObjectExplorerRequest(BaseModel):
    """
    Asks the backend to open a new, non-inline object explorer comm on the
    same object. Returns the new comm id.
    """

    method: Literal[ObjectExplorerBackendRequest.OpenObjectExplorer] = Field(
        description="The JSON-RPC method name (open_object_explorer)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class ObjectExplorerBackendMessageContent(BaseModel):
    comm_id: str
    data: Union[
        GetStateRequest,
        GetRootRequest,
        GetChildrenRequest,
        SearchRequest,
        FormatValueRequest,
        OpenObjectExplorerRequest,
    ] = Field(..., discriminator="method")


@enum.unique
class ObjectExplorerFrontendEvent(str, enum.Enum):
    """
    An enumeration of all the possible events that can be sent to the frontend object_explorer comm.
    """

    # The explored object changed
    Update = "update"


ObjectExplorerState.update_forward_refs()

ChildrenResult.update_forward_refs()

SearchResult.update_forward_refs()

FormattedValue.update_forward_refs()

ObjectNode.update_forward_refs()

SearchRow.update_forward_refs()

GetStateRequest.update_forward_refs()

GetRootRequest.update_forward_refs()

GetChildrenParams.update_forward_refs()

GetChildrenRequest.update_forward_refs()

SearchParams.update_forward_refs()

SearchRequest.update_forward_refs()

FormatValueParams.update_forward_refs()

FormatValueRequest.update_forward_refs()

OpenObjectExplorerRequest.update_forward_refs()
