# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Kernel integration for Positron.

This module provides integration with IJulia to start and manage Positron services.
"""

using IJulia

"""
Main Positron kernel that manages all services.
"""
mutable struct PositronKernel
    variables::VariablesService
    help::HelpService
    plots::PlotsService
    data_explorer::DataExplorerService
    ui::UIService

    # Registered comms by target name
    comms::Dict{String,PositronComm}

    # Flag to track if services are started
    started::Bool

    function PositronKernel()
        new(
            VariablesService(),
            HelpService(),
            PlotsService(),
            DataExplorerService(),
            UIService(),
            Dict{String,PositronComm}(),
            false,
        )
    end
end

# Global kernel instance
const _kernel = Ref{Union{PositronKernel,Nothing}}(nothing)

"""
Get the global kernel instance, creating it if necessary.
"""
function get_kernel()::PositronKernel
    if _kernel[] === nothing
        _kernel[] = PositronKernel()
    end
    return _kernel[]
end

"""
Start all Positron services.
"""
function start_services!(kernel::PositronKernel = get_kernel())
    if kernel.started
        @warn "Positron services already started"
        return
    end

    @info "Starting Positron services for Julia..."

    # Comm targets are auto-registered via IJulia.register_comm type dispatch methods

    # Set up execution hooks
    setup_execution_hooks!(kernel)

    kernel.started = true
    @info "Positron services started"
end

"""
Stop all Positron services.
"""
function stop_services!(kernel::PositronKernel = get_kernel())
    if !kernel.started
        return
    end

    @info "Stopping Positron services..."

    # Close all comms
    for (_, comm) in kernel.comms
        try
            close!(comm)
        catch e
            @warn "Error closing comm" exception=e
        end
    end
    empty!(kernel.comms)

    kernel.started = false
    @info "Positron services stopped"
end

"""
Register Jupyter comm targets for Positron services.
"""
# IJulia comm target registration using type dispatch.
# IJulia calls these methods when a comm is opened with the corresponding target.

function IJulia.register_comm(comm::IJulia.Comm{Symbol("positron.variables")}, data)
    kernel = get_kernel()
    if kernel !== nothing
        handle_variables_comm_open(kernel, comm, data)
    end
end

function IJulia.register_comm(comm::IJulia.Comm{Symbol("positron.help")}, data)
    kernel = get_kernel()
    if kernel !== nothing
        handle_help_comm_open(kernel, comm, data)
    end
end

function IJulia.register_comm(comm::IJulia.Comm{Symbol("positron.plot")}, data)
    kernel = get_kernel()
    if kernel !== nothing
        handle_plot_comm_open(kernel, comm, data)
    end
end

function IJulia.register_comm(comm::IJulia.Comm{Symbol("positron.dataExplorer")}, data)
    kernel = get_kernel()
    if kernel !== nothing
        handle_data_explorer_comm_open(kernel, comm, data)
    end
end

function IJulia.register_comm(comm::IJulia.Comm{Symbol("positron.ui")}, data)
    kernel = get_kernel()
    if kernel !== nothing
        handle_ui_comm_open(kernel, comm, data)
    end
end

"""
Handle opening of variables comm.
"""
function handle_variables_comm_open(kernel::PositronKernel, ijulia_comm::Any, msg::Any)
    @debug "Variables comm opened"

    # Create our comm wrapper
    comm = create_comm("positron.variables")
    kernel.comms["variables"] = comm

    # Initialize the service with this comm
    init!(kernel.variables, comm)

    # Hook up to IJulia comm for message passing
    setup_comm_bridge!(comm, ijulia_comm)

    # Send initial refresh to populate Variables pane (like Python does)
    send_refresh!(kernel.variables)
end

"""
Handle opening of help comm.
"""
function handle_help_comm_open(kernel::PositronKernel, ijulia_comm::Any, msg::Any)
    @debug "Help comm opened"

    comm = create_comm("positron.help")
    kernel.comms["help"] = comm

    init!(kernel.help, comm)
    setup_comm_bridge!(comm, ijulia_comm)
end

"""
Handle opening of plot comm.
"""
function handle_plot_comm_open(kernel::PositronKernel, ijulia_comm::Any, msg::Any)
    @debug "Plot comm opened"

    comm = create_comm("positron.plot")
    kernel.comms["plot"] = comm

    init!(kernel.plots, comm)
    setup_comm_bridge!(comm, ijulia_comm)
end

"""
Handle opening of data explorer comm.
"""
function handle_data_explorer_comm_open(kernel::PositronKernel, ijulia_comm::Any, msg::Any)
    @debug "Data explorer comm opened"

    # Data explorer comms are per-dataset
    # Extract the variable info from the message
    data = get(msg, "content", Dict())
    content_data = get(data, "data", Dict())
    variable_path = get(content_data, "variable_path", String[])
    title = get(content_data, "title", "Data")

    if isempty(variable_path)
        @warn "Data explorer opened without variable path"
        return
    end

    # Get the data object
    data_obj = get_value_at_path(variable_path)
    if data_obj === nothing
        @warn "Variable not found" path=variable_path
        return
    end

    # Create instance
    instance = open_data_explorer!(kernel.data_explorer, data_obj, title)

    # Create comm for this instance
    comm = create_comm("positron.dataExplorer")
    init!(instance, comm)
    setup_comm_bridge!(comm, ijulia_comm)
end

"""
Handle opening of UI comm.
"""
function handle_ui_comm_open(kernel::PositronKernel, ijulia_comm::Any, msg::Any)
    @debug "UI comm opened"

    comm = create_comm("positron.ui")
    kernel.comms["ui"] = comm

    init!(kernel.ui, comm)
    setup_comm_bridge!(comm, ijulia_comm)
end

"""
Set up bidirectional message passing between our comm and IJulia comm.
"""
function setup_comm_bridge!(our_comm::PositronComm, ijulia_comm::Any)
    # Forward messages from IJulia to our comm
    if hasproperty(ijulia_comm, :on_msg)
        ijulia_comm.on_msg = function (msg)
            @info "Received comm message" comm_id=our_comm.comm_id
            content = get(msg, "content", Dict())
            data = get(content, "data", Dict())
            @info "Handling message" data_keys=keys(data)
            handle_msg(our_comm, data)
        end
    end

    if hasproperty(ijulia_comm, :on_close)
        ijulia_comm.on_close = function ()
            if our_comm.close_handler !== nothing
                our_comm.close_handler()
            end
        end
    end

    # Override our comm's send to use IJulia
    our_comm.kernel = ijulia_comm
end

"""
Override _send_msg to actually send via IJulia.
"""
function _send_msg(comm::PositronComm, data::Any, metadata::Union{Dict,Nothing})
    if comm.kernel === nothing
        @warn "No IJulia comm attached"
        return
    end

    @info "Sending comm message" comm_id=comm.comm_id data_type=typeof(data)

    # Convert to JSON
    json_data = JSON3.write(data)
    parsed_data = JSON3.read(json_data)

    # Send via IJulia comm
    try
        if hasproperty(comm.kernel, :send)
            @info "Sending via IJulia.Comm.send"
            comm.kernel.send(parsed_data)
        elseif isdefined(IJulia, :send_comm)
            @info "Sending via IJulia.send_comm"
            IJulia.send_comm(comm.kernel, parsed_data)
        else
            @warn "Cannot find method to send comm message"
        end
    catch e
        @error "Failed to send comm message" exception=(e, catch_backtrace())
    end
end

"""
Set up hooks for code execution to update variables, handle plots, etc.
"""
function setup_execution_hooks!(kernel::PositronKernel)
    # Hook into IJulia's post-execute callback
    if isdefined(IJulia, :postexecute_hooks)
        push!(IJulia.postexecute_hooks, () -> on_post_execute(kernel))
    end

    # Hook into display system for plots
    setup_display_hooks!(kernel)
end

"""
Called after each code execution.
"""
function on_post_execute(kernel::PositronKernel)
    try
        # Update variables pane
        send_update!(kernel.variables)
    catch e
        @error "Error in post-execute hook" exception=(e, catch_backtrace())
    end
end

"""
Set up display hooks for capturing plots.
"""
function setup_display_hooks!(kernel::PositronKernel)
    # Create a custom display for plots
    # This intercepts plot objects before they go to the default display

    # Note: This is a simplified approach. A more robust implementation would
    # involve creating a proper AbstractDisplay subtype.
end

# -------------------------------------------------------------------------
# Utility functions
# -------------------------------------------------------------------------

"""
Get value at a path (used by data explorer).
Re-exported from variables service.
"""
# This is defined in variables.jl, we just reference it here

"""
Open a data explorer for a value.
"""
function view(data::Any, title::String = "Data")
    kernel = get_kernel()
    if !kernel.started
        @warn "Positron services not started"
        return
    end

    # Create the data explorer instance
    instance = open_data_explorer!(kernel.data_explorer, data, title)

    # In Positron, the frontend would open a comm for this
    # For now, we just create the instance and wait for the comm
    @info "Data viewer opened for: $title"
end

"""
Show help for a symbol.
"""
function showhelp(topic::String)
    kernel = get_kernel()
    if !kernel.started
        @warn "Positron services not started"
        return
    end

    show_help!(kernel.help, topic)
end

# -------------------------------------------------------------------------
# IJulia Initialization
# -------------------------------------------------------------------------

"""
Initialize Positron when IJulia starts.
This should be called from the IJulia startup script.
"""
function __init__()
    # Check if we're running in Positron
    if get(ENV, "POSITRON", "") == "1" || get(ENV, "POSITRON_MODE", "") != ""
        @info "Positron environment detected, starting services..."

        # Delay initialization until IJulia is ready
        if isdefined(Main, :IJulia) && IJulia.inited
            start_services!()
        else
            # Queue initialization for when IJulia is ready
            @async begin
                # Wait for IJulia to be ready
                while !isdefined(Main, :IJulia) || !IJulia.inited
                    sleep(0.1)
                end
                start_services!()
            end
        end
    end
end
