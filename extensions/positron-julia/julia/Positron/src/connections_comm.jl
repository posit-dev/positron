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
struct ListObjectsParams
    path::Vector{ObjectSchema}
end

StructTypes.StructType(::Type{ListObjectsParams}) = StructTypes.Struct()

"""
List fields of an object, such as columns of a table or view.
"""
struct ListFieldsParams
    path::Vector{ObjectSchema}
end

StructTypes.StructType(::Type{ListFieldsParams}) = StructTypes.Struct()

"""
Check if an object contains data, such as a table or view.
"""
struct ContainsDataParams
    path::Vector{ObjectSchema}
end

StructTypes.StructType(::Type{ContainsDataParams}) = StructTypes.Struct()

"""
Get icon of an object, such as a table or view.
"""
struct GetIconParams
    path::Vector{ObjectSchema}
end

StructTypes.StructType(::Type{GetIconParams}) = StructTypes.Struct()

"""
Preview object data, such as a table or view.
"""
struct PreviewObjectParams
    path::Vector{ObjectSchema}
end

StructTypes.StructType(::Type{PreviewObjectParams}) = StructTypes.Struct()

"""
A connection has tied metadata such as an icon, the host, etc.
"""
struct GetMetadataParams
    comm_id::String
end

StructTypes.StructType(::Type{GetMetadataParams}) = StructTypes.Struct()

"""
Parse a backend request for the Connections comm.
"""
function parse_connections_request(data::Dict)
    method = get(data, "method", nothing)
    params = get(data, "params", Dict())

    if method == "list_objects"
        return ListObjectsParams(get(params, "path", []))
    elseif method == "list_fields"
        return ListFieldsParams(get(params, "path", []))
    elseif method == "contains_data"
        return ContainsDataParams(get(params, "path", []))
    elseif method == "get_icon"
        return GetIconParams(get(params, "path", []))
    elseif method == "preview_object"
        return PreviewObjectParams(get(params, "path", []))
    elseif method == "get_metadata"
        return GetMetadataParams(get(params, "comm_id", ""))
    else
        error("Unknown connections method: $method")
    end
end
