# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

#
# AUTO-GENERATED from connections.json; do not edit.
#

"""
ObjectSchema in Schemas
"""
struct ObjectSchema
    name::String
    kind::String
    has_children::Union{Bool,Nothing}
end

StructTypes.StructType(::Type{ObjectSchema}) = StructTypes.Struct()

"""
FieldSchema in Schemas
"""
struct FieldSchema
    name::String
    dtype::String
end

StructTypes.StructType(::Type{FieldSchema}) = StructTypes.Struct()

"""
MetadataSchema in Schemas
"""
struct MetadataSchema
    name::String
    language_id::String
    host::Union{String,Nothing}
    type_::Union{String,Nothing}
    code::Union{String,Nothing}
end

StructTypes.StructType(::Type{MetadataSchema}) = StructTypes.Struct()
StructTypes.names(::Type{MetadataSchema}) = ((:type_, :type),)

"""
List objects within a data source, such as schemas, catalogs, tables
and views.
"""
struct ConnectionsListObjectsParams
    path::Vector{ObjectSchema}
end

StructTypes.StructType(::Type{ConnectionsListObjectsParams}) = StructTypes.Struct()

"""
List fields of an object, such as columns of a table or view.
"""
struct ConnectionsListFieldsParams
    path::Vector{ObjectSchema}
end

StructTypes.StructType(::Type{ConnectionsListFieldsParams}) = StructTypes.Struct()

"""
Check if an object contains data, such as a table or view.
"""
struct ConnectionsContainsDataParams
    path::Vector{ObjectSchema}
end

StructTypes.StructType(::Type{ConnectionsContainsDataParams}) = StructTypes.Struct()

"""
Get icon of an object, such as a table or view.
"""
struct ConnectionsGetIconParams
    path::Vector{ObjectSchema}
end

StructTypes.StructType(::Type{ConnectionsGetIconParams}) = StructTypes.Struct()

"""
Preview object data, such as a table or view.
"""
struct ConnectionsPreviewObjectParams
    path::Vector{ObjectSchema}
end

StructTypes.StructType(::Type{ConnectionsPreviewObjectParams}) = StructTypes.Struct()

"""
A connection has tied metadata such as an icon, the host, etc.
"""
struct ConnectionsGetMetadataParams
    comm_id::String
end

StructTypes.StructType(::Type{ConnectionsGetMetadataParams}) = StructTypes.Struct()

"""
Parse a backend request for the Connections comm.
"""
function parse_connections_request(data::Dict)
    method = get(data, "method", nothing)
    params = get(data, "params", Dict())

    if method == "list_objects"
        return ConnectionsListObjectsParams(get(params, "path", []))
    elseif method == "list_fields"
        return ConnectionsListFieldsParams(get(params, "path", []))
    elseif method == "contains_data"
        return ConnectionsContainsDataParams(get(params, "path", []))
    elseif method == "get_icon"
        return ConnectionsGetIconParams(get(params, "path", []))
    elseif method == "preview_object"
        return ConnectionsPreviewObjectParams(get(params, "path", []))
    elseif method == "get_metadata"
        return ConnectionsGetMetadataParams(get(params, "comm_id", ""))
    else
        error("Unknown connections method: $method")
    end
end
