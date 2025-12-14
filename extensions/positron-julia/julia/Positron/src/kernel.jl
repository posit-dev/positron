# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Kernel integration for Positron.

This module provides integration with IJulia to start and manage Positron services.
"""

using IJulia
using Logging
using Dates

"""
Kernel logging functions - write to kernel log (not console).

Uses IJulia.orig_stderr which routes to Positron's Kernel output channel.
Includes timestamp and log level for clarity.
"""
function kernel_log_info(msg::String)
    if isdefined(IJulia, :orig_stderr) && IJulia.orig_stderr[] !== nothing
        timestamp = Dates.format(Dates.now(), "yyyy-mm-dd HH:MM:SS.sss")
        # Use print instead of write to avoid blank lines
        println(IJulia.orig_stderr[], "$timestamp [info] $msg")
    end
end

function kernel_log_warn(msg::String)
    if isdefined(IJulia, :orig_stderr) && IJulia.orig_stderr[] !== nothing
        timestamp = Dates.format(Dates.now(), "yyyy-mm-dd HH:MM:SS.sss")
        println(IJulia.orig_stderr[], "$timestamp [warn] $msg")
    end
end

function kernel_log_error(msg::String)
    if isdefined(IJulia, :orig_stderr) && IJulia.orig_stderr[] !== nothing
        timestamp = Dates.format(Dates.now(), "yyyy-mm-dd HH:MM:SS.sss")
        println(IJulia.orig_stderr[], "$timestamp [error] $msg")
    end
end

# Alias for convenience
kernel_log(msg::String) = kernel_log_info(msg)

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
    # Kernel logging uses direct writes to IJulia.orig_stderr (via kernel_log_* functions)
    # No need for ConsoleLogger configuration

    if kernel.started
        kernel_log_warn("Positron services already started")
        return
    end

    kernel_log_info("Starting Positron services for Julia...")

    # Comm targets are auto-registered via IJulia.register_comm type dispatch methods

    # Set up execution hooks
    setup_execution_hooks!(kernel)

    kernel.started = true
    kernel_log_info("Positron services started")
end

"""
Stop all Positron services.
"""
function stop_services!(kernel::PositronKernel = get_kernel())
    if !kernel.started
        return
    end

    kernel_log_info("Stopping Positron services...")

    # Close all comms
    for (_, comm) in kernel.comms
        try
            close!(comm)
        catch e
            kernel_log_warn("Error closing comm")
        end
    end
    empty!(kernel.comms)

    kernel.started = false
    kernel_log_info("Positron services stopped")
end

"""
Register Jupyter comm targets for Positron services.
"""
# IJulia comm target registration using type dispatch.
# IJulia calls these methods when a comm is opened with the corresponding target.

function IJulia.register_comm(comm::IJulia.Comm{Symbol("positron.variables")}, msg::IJulia.Msg)
    try
        kernel = get_kernel()
        if kernel !== nothing
            handle_variables_comm_open(kernel, comm, msg)
        end
    catch e
        kernel_log_error("Error in Variables comm registration: $e")
        rethrow(e)  # Re-throw so it's visible but logged first
    end
end

function IJulia.register_comm(comm::IJulia.Comm{Symbol("positron.help")}, msg::IJulia.Msg)
    kernel = get_kernel()
    if kernel !== nothing
        handle_help_comm_open(kernel, comm, msg)
    end
end

function IJulia.register_comm(comm::IJulia.Comm{Symbol("positron.plot")}, msg::IJulia.Msg)
    kernel = get_kernel()
    if kernel !== nothing
        handle_plot_comm_open(kernel, comm, msg)
    end
end

function IJulia.register_comm(comm::IJulia.Comm{Symbol("positron.dataExplorer")}, msg::IJulia.Msg)
    kernel = get_kernel()
    if kernel !== nothing
        handle_data_explorer_comm_open(kernel, comm, msg)
    end
end

function IJulia.register_comm(comm::IJulia.Comm{Symbol("positron.ui")}, msg::IJulia.Msg)
    kernel = get_kernel()
    if kernel !== nothing
        handle_ui_comm_open(kernel, comm, msg)
    end
end

"""
Handle opening of variables comm.
"""
function handle_variables_comm_open(kernel::PositronKernel, ijulia_comm::Any, msg::Any)
    kernel_log("Variables comm opened")

    # Create our comm wrapper
    comm = create_comm("positron.variables")
    kernel.comms["variables"] = comm

    # Initialize the service with this comm
    init!(kernel.variables, comm)

    # Hook up to IJulia comm for message passing
    setup_comm_bridge!(comm, ijulia_comm)

    # Don't send proactive refresh - wait for frontend to request
    # Frontend will send "list" request when ready, we'll respond to that
    kernel_log("Variables comm ready, waiting for frontend request")
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
        kernel_log_warn("Data explorer opened without variable path")
        return
    end

    # Get the data object
    data_obj = get_value_at_path(variable_path)
    if data_obj === nothing
        kernel_log_warn("Variable not found: $variable_path")
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
            kernel_log_info("Received comm message on $(our_comm.target_name): comm_id=$(our_comm.comm_id)")
            # msg is IJulia.Msg struct with .content field
            content = msg.content
            data = get(content, "data", Dict())
            kernel_log_info("Message data: $data")
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
        kernel_log_info("Warning: No IJulia comm attached")
        return
    end

    kernel_log_info("Sending comm message: $(comm.comm_id), type=$(typeof(data))")

    # Convert to Dict (IJulia expects Dict, not JSON3.Object)
    json_str = JSON3.write(data)
    kernel_log_info("Message JSON: $json_str")
    data_dict = JSON3.read(json_str, Dict{String,Any})

    # Send via IJulia comm
    # Use send_comm with explicit kernel parameter
    try
        kernel_log_info("Calling IJulia.send_comm with kernel parameter")
        # Get the IJulia kernel
        ijulia_kernel = isdefined(IJulia, :kernel) ? IJulia.kernel : IJulia._default_kernel
        IJulia.send_comm(comm.kernel, data_dict; kernel=ijulia_kernel)
        kernel_log_info("IJulia.send_comm completed successfully")
    catch e
        kernel_log_error("Failed to send comm message: $e")
        # Log full error for debugging
        kernel_log_error("Stack trace: $(sprint(showerror, e, catch_backtrace()))")
    end
end

"""
Set up hooks for code execution to update variables, handle plots, etc.
"""
function setup_execution_hooks!(kernel::PositronKernel)
    # Hook into IJulia's post-execute callback
    if isdefined(IJulia, :push_postexecute_hook)
        IJulia.push_postexecute_hook(() -> on_post_execute(kernel))
    elseif isdefined(IJulia, :_postexecute_hooks)
        push!(IJulia._postexecute_hooks, () -> on_post_execute(kernel))
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
        kernel_log_error("Error in post-execute hook: $e")
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
        kernel_log_warn("Positron services not started")
        return
    end

    # Create the data explorer instance
    instance = open_data_explorer!(kernel.data_explorer, data, title)

    # In Positron, the frontend would open a comm for this
    # For now, we just create the instance and wait for the comm
    kernel_log_info("Data viewer opened for: $title")
end

"""
Show help for a symbol.
"""
function showhelp(topic::String)
    kernel = get_kernel()
    if !kernel.started
        kernel_log_warn("Positron services not started")
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
    # Positron.start_services!() is called explicitly from kernel startup script
    # No automatic initialization needed here
end

"""
Test function to verify error logging works correctly.

This function deliberately throws an error to verify that:
1. The error is caught and logged to kernel log (not console)
2. Stack trace appears in kernel log
3. Error handling is working

Call with: Positron.test_error_logging()
"""
function test_error_logging()
    kernel_log_info("Testing error logging - you should see this in Kernel log")
    try
        # Deliberately cause an error
        error("This is a test error to verify kernel log captures errors correctly")
    catch e
        kernel_log_error("TEST: Caught error as expected: $e")
        kernel_log_info("If you see this in Kernel log (not console), error logging works!")
    end
end
