# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Variables service for Positron.

This module provides the Variables pane functionality, allowing users to browse
and inspect variables in the Julia session.
"""

# Note: Param types are now properly prefixed (VariablesUpdateParams, VariablesRefreshParams)
# to avoid naming conflicts with other comm files

"""
The Variables service manages the Variables pane in Positron.
"""
mutable struct VariablesService
    comm::Any  # PositronComm or test mock - using Any for testability
    current_version::Int
    last_snapshot::Dict{String,Any}  # Maps variable name to Variable

    function VariablesService()
        new(nothing, 0, Dict{String,Any}())
    end
end

"""
Initialize the variables service with a comm.
"""
function init!(service::VariablesService, comm::PositronComm)
    service.comm = comm

    on_msg!(comm, msg -> handle_variables_msg(service, msg))
    on_close!(comm, () -> handle_variables_close(service))

    # Send initial refresh immediately (matches Ark's behavior)
    # The comm now has comm_open_msg stored, which will be used as parent_header
    # This ensures the message is properly routed through the Supervisor
    send_refresh!(service)
end

"""
Handle incoming messages on the variables comm.
"""
function handle_variables_msg(service::VariablesService, msg::Dict)
    request = parse_variables_request(msg)

    if request === nothing
        # list request
        handle_list(service)
    elseif request isa VariablesClearParams
        handle_clear(service, request.include_hidden_objects)
    elseif request isa VariablesDeleteParams
        handle_delete(service, request.names)
    elseif request isa VariablesInspectParams
        handle_inspect(service, request.path)
    elseif request isa VariablesClipboardFormatParams
        handle_clipboard_format(service, request.path, request.format)
    elseif request isa VariablesViewParams
        handle_view(service, request.path)
    end
end

"""
Handle variables comm close.
"""
function handle_variables_close(service::VariablesService)
    service.comm = nothing
end

"""
Handle list request - return all variables in Main.
"""
function handle_list(service::VariablesService)
    variables = collect_variables()
    service.current_version += 1
    service.last_snapshot = Dict(v.display_name => v for v in variables)

    result = VariableList(variables, length(variables), service.current_version)
    send_result(service.comm, result)
end

"""
Handle clear request - clear all user-defined variables.
"""
function handle_clear(service::VariablesService, include_hidden::Bool)
    # Get all names in Main
    for name in names(Main; all = include_hidden)
        # Skip special names and modules
        if should_skip_variable(name)
            continue
        end
        try
            # Note: In Julia, we can't truly delete variables, but we can set them to nothing
            # or remove them from the workspace. For now, we'll skip this functionality
            # as it's complex to implement safely.
        catch e
            @warn "Failed to clear variable" name exception=e
        end
    end

    # Send updated variable list
    handle_list(service)
end

"""
Handle delete request - delete specific variables.
"""
function handle_delete(service::VariablesService, var_names::Vector{String})
    # Similar to clear, this is complex in Julia
    # For now, we acknowledge the request and send updated list
    handle_list(service)
end

"""
Handle inspect request - return children of a variable.
"""
function handle_inspect(service::VariablesService, path::Vector{String})
    if isempty(path)
        send_error(service.comm, JsonRpcErrorCode.INVALID_PARAMS, "Empty path")
        return
    end

    # Navigate to the value
    value = get_value_at_path(path)
    if value === nothing
        send_error(service.comm, JsonRpcErrorCode.INVALID_PARAMS, "Variable not found")
        return
    end

    # Get children
    children = get_children(value)
    result = InspectedVariable(children, length(children))
    send_result(service.comm, result)
end

"""
Handle clipboard format request - format variable for clipboard.
"""
function handle_clipboard_format(
    service::VariablesService,
    path::Vector{String},
    format::String,
)
    if isempty(path)
        send_error(service.comm, JsonRpcErrorCode.INVALID_PARAMS, "Empty path")
        return
    end

    value = get_value_at_path(path)
    if value === nothing
        send_error(service.comm, JsonRpcErrorCode.INVALID_PARAMS, "Variable not found")
        return
    end

    # Format the value
    content = format_for_clipboard(value, format)
    result = FormattedVariable(content)
    send_result(service.comm, result)
end

"""
Handle view request - open data viewer for variable.
"""
function handle_view(service::VariablesService, path::Vector{String})
    if isempty(path)
        send_error(service.comm, JsonRpcErrorCode.INVALID_PARAMS, "Empty path")
        return
    end

    # TODO: Open data explorer for the variable
    # For now, just acknowledge
    send_result(service.comm, nothing)
end

"""
Collect all visible variables from Main module.
"""
function collect_variables()::Vector{Variable}
    variables = Variable[]
    current_time = round(Int, time() * 1000)

    for name in names(Main; all = false)
        if should_skip_variable(name)
            continue
        end

        try
            value = getfield(Main, name)
            var = create_variable(string(name), value, current_time)
            push!(variables, var)
        catch e
            @debug "Failed to collect variable" name exception=e
        end
    end

    return variables
end

"""
Check if a variable should be skipped (internal, special, etc).
"""
function should_skip_variable(name::Symbol)::Bool
    name_str = string(name)

    # Skip internal Julia names
    if startswith(name_str, "#") || startswith(name_str, "_")
        return true
    end

    # Skip certain well-known names
    if name in (:Base, :Core, :Main, :ans, :include, :eval)
        return true
    end

    # Skip modules (they're not user variables)
    try
        val = getfield(Main, name)
        if val isa Module
            return true
        end
    catch
        return true
    end

    return false
end

"""
Create a Variable struct for a value.
"""
function create_variable(name::String, value::Any, timestamp::Int)::Variable
    kind = get_variable_kind(value)
    display_value = get_display_value(value)
    display_type = get_display_type(value)
    type_info = string(typeof(value))
    len = get_variable_length(value)
    sz = get_variable_size(value)
    has_children = value_has_children(value)
    has_viewer = value_has_viewer(value)
    is_truncated = length(display_value) >= 1000

    # Field order matches generated Variable struct:
    # access_key, display_name, display_value, display_type, type_info,
    # size, kind, length, has_children, has_viewer, is_truncated, updated_time
    Variable(
        name,           # access_key
        name,           # display_name
        display_value,
        display_type,
        type_info,
        sz,             # size
        kind,           # kind
        len,            # length
        has_children,
        has_viewer,
        is_truncated,
        timestamp,       # updated_time
    )
end

"""
Determine the VariableKind for a value.
"""
function get_variable_kind(value::Any)::VariableKind
    if value isa Bool
        return VariableKind_Boolean
    elseif value isa Number
        return VariableKind_Number
    elseif value isa AbstractString
        return VariableKind_String
    elseif value isa Function
        return VariableKind_Function
    elseif value isa AbstractDict
        return VariableKind_Map
    elseif value isa AbstractArray
        return VariableKind_Collection
    elseif value === nothing || value === missing
        return VariableKind_Empty
    elseif is_table_like(value)
        return VariableKind_Table
    elseif value isa Type
        return VariableKind_Class
    else
        return VariableKind_Other
    end
end

"""
Check if a value is table-like (DataFrames, etc).
"""
function is_table_like(value::Any)::Bool
    # Check for Tables.jl interface
    try
        # Try to use Tables.istable if available
        if isdefined(Main, :Tables) && isdefined(Main.Tables, :istable)
            return Main.Tables.istable(value)
        end
    catch
    end

    # Check for common table types by name
    type_name = string(typeof(value))
    return occursin("DataFrame", type_name) ||
           occursin("Table", type_name) ||
           occursin("Matrix", type_name)
end

"""
Get the display value for a variable.

For DataFrames, shows dimensions like "[5 rows x 3 columns] DataFrame".
"""
function get_display_value(value::Any)::String
    # Special handling for DataFrames
    if isdefined(Main, :DataFrames) && value isa Main.DataFrames.DataFrame
        try
            rows = Main.DataFrames.nrow(value)
            cols = Main.DataFrames.ncol(value)
            return "[$rows rows x $cols columns] DataFrame"
        catch
        end
    end

    # Default display
    try
        io = IOBuffer()
        show(IOContext(io, :compact => true, :limit => true), value)
        str = String(take!(io))
        # Truncate if too long
        if length(str) > 1000
            return str[1:1000] * "..."
        end
        return str
    catch e
        return "<error displaying value>"
    end
end

"""
Get the display type for a variable.

For DataFrames, shows dimensions like "DataFrame [5x3]".
"""
function get_display_type(value::Any)::String
    # Special handling for DataFrames
    if isdefined(Main, :DataFrames) && value isa Main.DataFrames.DataFrame
        try
            rows = Main.DataFrames.nrow(value)
            cols = Main.DataFrames.ncol(value)
            return "DataFrame [$rows x $cols]"
        catch
        end
    end

    T = typeof(value)

    # Simplify common type names
    if T <: AbstractVector
        eltype_str = string(eltype(value))
        return "Vector{$eltype_str}"
    elseif T <: AbstractMatrix
        eltype_str = string(eltype(value))
        return "Matrix{$eltype_str}"
    elseif T <: AbstractDict
        return "Dict"
    else
        type_str = string(T)
        # Truncate long type names
        if length(type_str) > 50
            return type_str[1:50] * "..."
        end
        return type_str
    end
end

"""
Get the length of a variable (for collections).

For DataFrames, returns the number of rows (nrow).
For other collections, returns length().
"""
function get_variable_length(value::Any)::Int
    # Handle DataFrames specially - use nrow()
    if is_table_like(value)
        try
            # Try to get row count via Tables.jl interface or nrow
            if isdefined(Main, :DataFrames) && value isa Main.DataFrames.DataFrame
                return Main.DataFrames.nrow(value)
            elseif isdefined(Main, :Tables) && isdefined(Main.Tables, :rowcount)
                rc = Main.Tables.rowcount(value)
                return rc === nothing ? 0 : rc
            end
        catch
        end
    end

    # For other types, use length()
    try
        return length(value)
    catch
        return 0
    end
end

"""
Get the size in bytes of a variable.
"""
function get_variable_size(value::Any)::Int64
    try
        return Int64(Base.summarysize(value))
    catch
        return Int64(0)
    end
end

"""
Check if a value has children that can be inspected.
"""
function value_has_children(value::Any)::Bool
    if value isa AbstractDict || value isa AbstractArray
        return !isempty(value)
    elseif value isa Number || value isa AbstractString || value isa Bool
        return false
    elseif value === nothing || value === missing
        return false
    elseif value isa Function
        return false
    else
        # Struct-like types have fields
        return fieldcount(typeof(value)) > 0
    end
end

"""
Check if a value can be viewed in the data explorer.
"""
function value_has_viewer(value::Any)::Bool
    # Tables and matrices can be viewed
    if is_table_like(value) || value isa AbstractMatrix
        return true
    end

    # Large vectors could potentially be viewed
    if value isa AbstractVector && length(value) > 10
        return true
    end

    return false
end

"""
Get the value at a given path.
"""
function get_value_at_path(path::Vector{String})
    if isempty(path)
        return nothing
    end

    # Start from Main
    try
        current = getfield(Main, Symbol(path[1]))

        for key in path[2:end]
            current = get_child_value(current, key)
            if current === nothing
                return nothing
            end
        end

        return current
    catch e
        @debug "Failed to get value at path" path exception=e
        return nothing
    end
end

"""
Get a child value from a parent.
"""
function get_child_value(parent::Any, key::String)
    # Try dictionary access
    if parent isa AbstractDict
        # Try string key first
        if haskey(parent, key)
            return parent[key]
        end
        # Try symbol key
        if haskey(parent, Symbol(key))
            return parent[Symbol(key)]
        end
        # Try integer key
        idx = tryparse(Int, key)
        if idx !== nothing && haskey(parent, idx)
            return parent[idx]
        end
    end

    # Try array access
    if parent isa AbstractArray
        idx = tryparse(Int, key)
        if idx !== nothing && checkbounds(Bool, parent, idx)
            return parent[idx]
        end
    end

    # Try field access
    sym = Symbol(key)
    if hasfield(typeof(parent), sym)
        return getfield(parent, sym)
    end

    return nothing
end

"""
Get children of a value for inspection.
"""
function get_children(value::Any)::Vector{Variable}
    children = Variable[]
    current_time = round(Int, time() * 1000)

    if value isa AbstractDict
        for (k, v) in value
            key_str = string(k)
            push!(children, create_variable(key_str, v, current_time))
        end
    elseif value isa AbstractArray
        # Limit number of children shown
        n = min(length(value), 100)
        for i = 1:n
            push!(children, create_variable("[$i]", value[i], current_time))
        end
    else
        # Get fields
        for field in fieldnames(typeof(value))
            try
                field_value = getfield(value, field)
                push!(children, create_variable(string(field), field_value, current_time))
            catch
            end
        end
    end

    return children
end

"""
Format a value for clipboard.
"""
function format_for_clipboard(value::Any, format::String)::String
    if format == "text/plain"
        io = IOBuffer()
        show(IOContext(io, :limit => false), MIME("text/plain"), value)
        return String(take!(io))
    else
        return repr(value)
    end
end

"""
Send a refresh event to the frontend.
"""
function send_refresh!(service::VariablesService)
    if service.comm === nothing
        return
    end

    variables = collect_variables()
    service.current_version += 1
    service.last_snapshot = Dict(v.display_name => v for v in variables)

    params = VariablesRefreshParams(variables, length(variables), service.current_version)
    send_event(service.comm, "refresh", params)
end

"""
Send an update event to the frontend with changes.
"""
function send_update!(service::VariablesService)
    if service.comm === nothing
        return
    end

    # Compute diff from last snapshot
    current_vars = collect_variables()
    current_map = Dict(v.display_name => v for v in current_vars)

    assigned = Variable[]
    removed = String[]

    # Find new or changed variables
    for var in current_vars
        if !haskey(service.last_snapshot, var.display_name)
            push!(assigned, var)
        elseif service.last_snapshot[var.display_name].display_value != var.display_value
            push!(assigned, var)
        end
    end

    # Find removed variables
    for name in keys(service.last_snapshot)
        if !haskey(current_map, name)
            push!(removed, name)
        end
    end

    # Only send if there are changes
    if !isempty(assigned) || !isempty(removed)
        service.current_version += 1
        service.last_snapshot = current_map

        params =
            VariablesUpdateParams(assigned, Variable[], removed, service.current_version)
        send_event(service.comm, "update", params)
    end
end
