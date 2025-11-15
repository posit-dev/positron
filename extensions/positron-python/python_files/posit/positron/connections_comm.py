#
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

#
# AUTO-GENERATED from connections.json; do not edit.
#

# flake8: noqa

# For forward declarations
from __future__ import annotations

import enum
from typing import Any, List, Literal, Optional, Union

from ._vendor.pydantic import BaseModel, Field, StrictBool, StrictFloat, StrictInt, StrictStr


class ObjectSchema(BaseModel):
    """
    ObjectSchema in Schemas
    """

    name: StrictStr = Field(
        description="Name of the underlying object",
    )

    kind: StrictStr = Field(
        description="The object type (table, catalog, schema)",
    )

    has_children: Optional[StrictBool] = Field(
        default=None,
        description="Indicates if the object has children that can be listed. This property is optional and when omitted, it is assumed that the object may have children unless its kind is 'field'.",
    )


class FieldSchema(BaseModel):
    """
    FieldSchema in Schemas
    """

    name: StrictStr = Field(
        description="Name of the field",
    )

    dtype: StrictStr = Field(
        description="The field data type",
    )


class MetadataSchema(BaseModel):
    """
    MetadataSchema in Schemas
    """

    name: StrictStr = Field(
        description="Connection name",
    )

    language_id: StrictStr = Field(
        description="Language ID for the connections. Essentially just R or python",
    )

    host: Optional[StrictStr] = Field(
        default=None,
        description="Connection host",
    )

    type: Optional[StrictStr] = Field(
        default=None,
        description="Connection type",
    )

    code: Optional[StrictStr] = Field(
        default=None,
        description="Code used to re-create the connection",
    )


@enum.unique
class ConnectionsBackendRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the backend connections comm.
    """

    # List objects within a data source
    ListObjects = "list_objects"

    # List fields of an object
    ListFields = "list_fields"

    # Check if an object contains data
    ContainsData = "contains_data"

    # Get icon of an object
    GetIcon = "get_icon"

    # Preview object data
    PreviewObject = "preview_object"

    # Gets metadata from the connections
    GetMetadata = "get_metadata"


class ListObjectsParams(BaseModel):
    """
    List objects within a data source, such as schemas, catalogs, tables
    and views.
    """

    path: List[ObjectSchema] = Field(
        description="The path to object that we want to list children.",
    )


class ListObjectsRequest(BaseModel):
    """
    List objects within a data source, such as schemas, catalogs, tables
    and views.
    """

    params: ListObjectsParams = Field(
        description="Parameters to the ListObjects method",
    )

    method: Literal[ConnectionsBackendRequest.ListObjects] = Field(
        description="The JSON-RPC method name (list_objects)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class ListFieldsParams(BaseModel):
    """
    List fields of an object, such as columns of a table or view.
    """

    path: List[ObjectSchema] = Field(
        description="The path to object that we want to list fields.",
    )


class ListFieldsRequest(BaseModel):
    """
    List fields of an object, such as columns of a table or view.
    """

    params: ListFieldsParams = Field(
        description="Parameters to the ListFields method",
    )

    method: Literal[ConnectionsBackendRequest.ListFields] = Field(
        description="The JSON-RPC method name (list_fields)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class ContainsDataParams(BaseModel):
    """
    Check if an object contains data, such as a table or view.
    """

    path: List[ObjectSchema] = Field(
        description="The path to object that we want to check if it contains data.",
    )


class ContainsDataRequest(BaseModel):
    """
    Check if an object contains data, such as a table or view.
    """

    params: ContainsDataParams = Field(
        description="Parameters to the ContainsData method",
    )

    method: Literal[ConnectionsBackendRequest.ContainsData] = Field(
        description="The JSON-RPC method name (contains_data)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class GetIconParams(BaseModel):
    """
    Get icon of an object, such as a table or view.
    """

    path: List[ObjectSchema] = Field(
        description="The path to object that we want to get the icon.",
    )


class GetIconRequest(BaseModel):
    """
    Get icon of an object, such as a table or view.
    """

    params: GetIconParams = Field(
        description="Parameters to the GetIcon method",
    )

    method: Literal[ConnectionsBackendRequest.GetIcon] = Field(
        description="The JSON-RPC method name (get_icon)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class PreviewObjectParams(BaseModel):
    """
    Preview object data, such as a table or view.
    """

    path: List[ObjectSchema] = Field(
        description="The path to object that we want to preview.",
    )


class PreviewObjectRequest(BaseModel):
    """
    Preview object data, such as a table or view.
    """

    params: PreviewObjectParams = Field(
        description="Parameters to the PreviewObject method",
    )

    method: Literal[ConnectionsBackendRequest.PreviewObject] = Field(
        description="The JSON-RPC method name (preview_object)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class GetMetadataParams(BaseModel):
    """
    A connection has tied metadata such as an icon, the host, etc.
    """

    comm_id: StrictStr = Field(
        description="The comm_id of the client we want to retrieve metdata for.",
    )


class GetMetadataRequest(BaseModel):
    """
    A connection has tied metadata such as an icon, the host, etc.
    """

    params: GetMetadataParams = Field(
        description="Parameters to the GetMetadata method",
    )

    method: Literal[ConnectionsBackendRequest.GetMetadata] = Field(
        description="The JSON-RPC method name (get_metadata)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class ConnectionsBackendMessageContent(BaseModel):
    comm_id: str
    data: Union[
        ListObjectsRequest,
        ListFieldsRequest,
        ContainsDataRequest,
        GetIconRequest,
        PreviewObjectRequest,
        GetMetadataRequest,
    ] = Field(..., discriminator="method")


@enum.unique
class ConnectionsFrontendEvent(str, enum.Enum):
    """
    An enumeration of all the possible events that can be sent to the frontend connections comm.
    """

    # Request to focus the Connections pane
    Focus = "focus"

    # Request the UI to refresh the connection information
    Update = "update"


ObjectSchema.update_forward_refs()

FieldSchema.update_forward_refs()

MetadataSchema.update_forward_refs()

ListObjectsParams.update_forward_refs()

ListObjectsRequest.update_forward_refs()

ListFieldsParams.update_forward_refs()

ListFieldsRequest.update_forward_refs()

ContainsDataParams.update_forward_refs()

ContainsDataRequest.update_forward_refs()

GetIconParams.update_forward_refs()

GetIconRequest.update_forward_refs()

PreviewObjectParams.update_forward_refs()

PreviewObjectRequest.update_forward_refs()

GetMetadataParams.update_forward_refs()

GetMetadataRequest.update_forward_refs()
