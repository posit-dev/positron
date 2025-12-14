# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

#
# AUTO-GENERATED from variables.json; do not edit.
#

"""
Possible values for Format in ClipboardFormat
"""
@enum ClipboardFormatFormat begin
    ClipboardFormatFormat_TextHtml
    ClipboardFormatFormat_TextPlain
end

const CLIPBOARDFORMATFORMAT_MAP = Dict(
    ClipboardFormatFormat_TextHtml => "text/html",
    ClipboardFormatFormat_TextPlain => "text/plain",
)

const STRING_TO_CLIPBOARDFORMATFORMAT = Dict(v => k for (k, v) in CLIPBOARDFORMATFORMAT_MAP)

StructTypes.StructType(::Type{ClipboardFormatFormat}) = StructTypes.StringType()
StructTypes.construct(::Type{ClipboardFormatFormat}, s::String) =
    STRING_TO_CLIPBOARDFORMATFORMAT[s]
Base.string(x::ClipboardFormatFormat) = CLIPBOARDFORMATFORMAT_MAP[x]

"""
Possible values for Kind in Variable
"""
@enum VariableKind begin
    VariableKind_Boolean
    VariableKind_Bytes
    VariableKind_Class
    VariableKind_Collection
    VariableKind_Empty
    VariableKind_Function
    VariableKind_Map
    VariableKind_Number
    VariableKind_Other
    VariableKind_String
    VariableKind_Table
    VariableKind_Lazy
    VariableKind_Connection
end

const VARIABLEKIND_MAP = Dict(
    VariableKind_Boolean => "boolean",
    VariableKind_Bytes => "bytes",
    VariableKind_Class => "class",
    VariableKind_Collection => "collection",
    VariableKind_Empty => "empty",
    VariableKind_Function => "function",
    VariableKind_Map => "map",
    VariableKind_Number => "number",
    VariableKind_Other => "other",
    VariableKind_String => "string",
    VariableKind_Table => "table",
    VariableKind_Lazy => "lazy",
    VariableKind_Connection => "connection",
)

const STRING_TO_VARIABLEKIND = Dict(v => k for (k, v) in VARIABLEKIND_MAP)

StructTypes.StructType(::Type{VariableKind}) = StructTypes.StringType()
StructTypes.construct(::Type{VariableKind}, s::String) = STRING_TO_VARIABLEKIND[s]
Base.string(x::VariableKind) = VARIABLEKIND_MAP[x]

"""
A single variable in the runtime.
"""
struct Variable
    access_key::String
    display_name::String
    display_value::String
    display_type::String
    type_info::String
    size::Int64
    kind::VariableKind
    length::Int64
    has_children::Bool
    has_viewer::Bool
    is_truncated::Bool
    updated_time::Int64
end

StructTypes.StructType(::Type{Variable}) = StructTypes.Struct()

"""
A view containing a list of variables in the session.
"""
struct VariableList
    variables::Vector{Variable}
    length::Int64
    version::Union{Int64,Nothing}
end

StructTypes.StructType(::Type{VariableList}) = StructTypes.Struct()

"""
An inspected variable.
"""
struct InspectedVariable
    children::Vector{Variable}
    length::Int64
end

StructTypes.StructType(::Type{InspectedVariable}) = StructTypes.Struct()

"""
An object formatted for copying to the clipboard.
"""
struct FormattedVariable
    content::String
end

StructTypes.StructType(::Type{FormattedVariable}) = StructTypes.Struct()

"""
Result of the summarize operation
"""
struct QueryTableSummaryResult
    num_rows::Int64
    num_columns::Int64
    column_schemas::Vector{String}
    column_profiles::Vector{String}
end

StructTypes.StructType(::Type{QueryTableSummaryResult}) = StructTypes.Struct()

"""
Clears (deletes) all variables in the current session.
"""
struct VariablesClearParams
    include_hidden_objects::Bool
end

StructTypes.StructType(::Type{VariablesClearParams}) = StructTypes.Struct()

"""
Deletes the named variables from the current session.
"""
struct VariablesDeleteParams
    names::Vector{String}
end

StructTypes.StructType(::Type{VariablesDeleteParams}) = StructTypes.Struct()

"""
Returns the children of a variable, as an array of variables.
"""
struct VariablesInspectParams
    path::Vector{String}
end

StructTypes.StructType(::Type{VariablesInspectParams}) = StructTypes.Struct()

"""
Requests a formatted representation of a variable for copying to the
clipboard.
"""
struct VariablesClipboardFormatParams
    path::Vector{String}
    format::ClipboardFormatFormat
end

StructTypes.StructType(::Type{VariablesClipboardFormatParams}) = StructTypes.Struct()

"""
Request that the runtime open a data viewer to display the data in a
variable.
"""
struct VariablesViewParams
    path::Vector{String}
end

StructTypes.StructType(::Type{VariablesViewParams}) = StructTypes.Struct()

"""
Request a data summary for a table variable.
"""
struct VariablesQueryTableSummaryParams
    path::Vector{String}
    query_types::Vector{String}
end

StructTypes.StructType(::Type{VariablesQueryTableSummaryParams}) = StructTypes.Struct()

"""
Event: Update variables
"""
struct VariablesUpdateParams
    assigned::Vector{Variable}
    unevaluated::Vector{Variable}
    removed::Vector{String}
    version::Int64
end

StructTypes.StructType(::Type{VariablesUpdateParams}) = StructTypes.Struct()

"""
Event: Refresh variables
"""
struct VariablesRefreshParams
    variables::Vector{Variable}
    length::Int64
    version::Int64
end

StructTypes.StructType(::Type{VariablesRefreshParams}) = StructTypes.Struct()

"""
Parse a backend request for the Variables comm.
"""
function parse_variables_request(data::Dict)
    method = get(data, "method", nothing)
    params = get(data, "params", Dict())

    if method == "list"
        return nothing
    elseif method == "clear"
        return VariablesClearParams(get(params, "include_hidden_objects", false))
    elseif method == "delete"
        return VariablesDeleteParams(get(params, "names", []))
    elseif method == "inspect"
        return VariablesInspectParams(get(params, "path", []))
    elseif method == "clipboard_format"
        format_str = get(params, "format", "text/plain")
        format_enum = StructTypes.construct(ClipboardFormatFormat, format_str)
        return VariablesClipboardFormatParams(get(params, "path", []), format_enum)
    elseif method == "view"
        return VariablesViewParams(get(params, "path", []))
    elseif method == "query_table_summary"
        return VariablesQueryTableSummaryParams(
            get(params, "path", []),
            get(params, "query_types", []),
        )
    else
        error("Unknown variables method: $method")
    end
end
