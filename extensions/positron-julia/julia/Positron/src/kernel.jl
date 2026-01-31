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

# Global log file handle
const _log_file = Ref{Union{IOStream,Nothing}}(nothing)

"""
Get the log file stream for kernel logging.

Uses POSITRON_KERNEL_LOG environment variable which points to a log file.
The supervisor streams this file to the Kernel output tab via LogStreamer.

On session reconnect, the supervisor finds the log file path from the --logfile
argument and continues streaming from the same file.
"""
function get_log_stream()
    # Return cached file handle if already open and still valid
    if _log_file[] !== nothing && isopen(_log_file[])
        return _log_file[]
    end

    # Clear stale handle
    _log_file[] = nothing

    # Try to open log file from environment variable
    log_path = get(ENV, "POSITRON_KERNEL_LOG", "")
    if !isempty(log_path)
        try
            _log_file[] = open(log_path, "a")
            return _log_file[]
        catch
            # Fall back to stderr if we can't open the log file
        end
    end

    # Fall back to orig_stderr
    if isdefined(IJulia, :orig_stderr) && IJulia.orig_stderr[] !== nothing
        return IJulia.orig_stderr[]
    end

    return nothing
end

"""
Kernel logging functions - write to log file or stderr.

Output is streamed by the supervisor's LogStreamer and shown in the Kernel output tab.
"""
function kernel_log_info(msg::String)
    stream = get_log_stream()
    if stream !== nothing
        timestamp = Dates.format(Dates.now(), "yyyy-mm-dd HH:MM:SS.sss")
        println(stream, "$timestamp [info] $msg")
        flush(stream)
    end
end

function kernel_log_warn(msg::String)
    stream = get_log_stream()
    if stream !== nothing
        timestamp = Dates.format(Dates.now(), "yyyy-mm-dd HH:MM:SS.sss")
        println(stream, "$timestamp [warn] $msg")
        flush(stream)
    end
end

function kernel_log_error(msg::String)
    stream = get_log_stream()
    if stream !== nothing
        timestamp = Dates.format(Dates.now(), "yyyy-mm-dd HH:MM:SS.sss")
        println(stream, "$timestamp [error] $msg")
        flush(stream)
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

    # Install custom is_complete_request handler for proper multi-line code handling
    install_is_complete_handler!()

    # Comm targets are auto-registered via IJulia.register_comm type dispatch methods
    # for services that wait for the frontend to open comms (variables, help, data_explorer, ui)

    # Initialize plots service immediately (uses kernel-initiated comms like Python)
    # The PositronDisplay will be installed to capture plots from Julia's display system
    init!(kernel.plots)

    # Set up execution hooks
    setup_execution_hooks!(kernel)

    # Register atexit handler to clean up on graceful shutdown
    atexit(() -> stop_services!(kernel))

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

    # Shutdown plots service (closes all plot comms)
    shutdown!(kernel.plots)

    # Close all other comms
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

function IJulia.register_comm(
    comm::IJulia.Comm{Symbol("positron.variables")},
    msg::IJulia.Msg,
)
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

function IJulia.register_comm(
    comm::IJulia.Comm{Symbol("positron.dataExplorer")},
    msg::IJulia.Msg,
)
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

    # Create our comm wrapper with the same ID as the IJulia comm
    comm = create_comm("positron.variables"; comm_id = ijulia_comm.id)
    kernel.comms["variables"] = comm

    # Store comm_open message to use as parent for initial messages
    # This is critical: during comm_open, kernel.execute_msg is stale/invalid
    # Using the comm_open message as parent ensures valid parent_header
    comm.comm_open_msg = msg

    # Hook up to IJulia comm FIRST (sets comm.kernel)
    setup_comm_bridge!(comm, ijulia_comm)

    # THEN initialize service (which sends initial refresh)
    init!(kernel.variables, comm)

    kernel_log("Variables comm initialized")
end

"""
Handle opening of help comm.
"""
function handle_help_comm_open(kernel::PositronKernel, ijulia_comm::Any, msg::Any)
    kernel_log_info("Help comm opened")

    comm = create_comm("positron.help"; comm_id = ijulia_comm.id)
    kernel.comms["help"] = comm

    init!(kernel.help, comm)
    setup_comm_bridge!(comm, ijulia_comm)
end

"""
Handle opening of plot comm.
"""
function handle_plot_comm_open(kernel::PositronKernel, ijulia_comm::Any, msg::Any)
    kernel_log_info("Plot comm opened")

    comm = create_comm("positron.plot"; comm_id = ijulia_comm.id)
    kernel.comms["plot"] = comm

    init!(kernel.plots, comm)
    setup_comm_bridge!(comm, ijulia_comm)
end

"""
Handle opening of data explorer comm.
"""
function handle_data_explorer_comm_open(kernel::PositronKernel, ijulia_comm::Any, msg::Any)
    kernel_log_info("Data explorer comm opened")

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

    # Create comm for this instance with the same ID as the IJulia comm
    comm = create_comm("positron.dataExplorer"; comm_id = ijulia_comm.id)
    init!(instance, comm)
    setup_comm_bridge!(comm, ijulia_comm)
end

"""
Handle opening of UI comm.
"""
function handle_ui_comm_open(kernel::PositronKernel, ijulia_comm::Any, msg::Any)
    kernel_log_info("UI comm opened")

    comm = create_comm("positron.ui"; comm_id = ijulia_comm.id)
    kernel.comms["ui"] = comm

    init!(kernel.ui, comm)
    setup_comm_bridge!(comm, ijulia_comm)
end

"""
Set up bidirectional message passing between our comm and IJulia comm.

For frontend-initiated comms, we need to register them in IJulia's comm registry
so that incoming messages are routed correctly.
"""
function setup_comm_bridge!(our_comm::PositronComm, ijulia_comm::Any)
    # Get the IJulia kernel for registration
    ijulia_kernel = isdefined(IJulia, :kernel) ? IJulia.kernel : IJulia._default_kernel

    # Check if IJulia already registered this comm and register if not.
    # For frontend-initiated comms, IJulia may not have registered the comm yet.
    if ijulia_kernel !== nothing && hasproperty(ijulia_comm, :id)
        comm_id = ijulia_comm.id
        already_registered = haskey(ijulia_kernel.comms, comm_id)
        if already_registered
            kernel_log_info("Comm already in registry: $(our_comm.target_name), id=$comm_id")
        else
            ijulia_kernel.comms[comm_id] = ijulia_comm
            kernel_log_info("Registered frontend-initiated comm: $(our_comm.target_name), id=$comm_id")
        end
    end

    # Forward messages from IJulia to our comm
    # CRITICAL: Wrap in try-catch to prevent errors from breaking IJulia event loop
    if hasproperty(ijulia_comm, :on_msg)
        kernel_log_info("Setting on_msg handler for $(our_comm.target_name), comm_id=$(ijulia_comm.id)")
        ijulia_comm.on_msg = function (msg)
            try
                kernel_log_info(
                    "Received comm message on $(our_comm.target_name): comm_id=$(ijulia_comm.id)",
                )
                # Store the incoming message to use as parent for response
                our_comm.current_request_msg = msg

                # msg is IJulia.Msg struct with .content field
                content = msg.content
                data = get(content, "data", Dict())
                kernel_log_info("Message data: $data")
                handle_msg(our_comm, data)
            catch e
                # Log but never let errors escape to IJulia - that breaks the kernel
                kernel_log_error("FATAL: Unhandled error in comm on_msg: $(sprint(showerror, e, catch_backtrace()))")
            finally
                # Clear the request message after handling
                our_comm.current_request_msg = nothing
            end
        end
        # Verify the handler was set
        if ijulia_comm.on_msg !== nothing
            kernel_log_info("on_msg handler set successfully for $(our_comm.target_name)")
        else
            kernel_log_error("on_msg handler is still nothing for $(our_comm.target_name)!")
        end
    else
        kernel_log_error("IJulia comm does not have on_msg property for $(our_comm.target_name)")
    end

    if hasproperty(ijulia_comm, :on_close)
        ijulia_comm.on_close = function ()
            try
                if our_comm.close_handler !== nothing
                    our_comm.close_handler()
                end
            catch e
                kernel_log_error("Error in comm on_close: $(sprint(showerror, e))")
            end
        end
    end

    # Override our comm's send to use IJulia
    our_comm.kernel = ijulia_comm
end

"""
Override _send_msg to actually send via IJulia.

This function handles the critical parent_header issue:
- During comm_open, kernel.execute_msg is stale/invalid
- We use the stored comm_open_msg as parent for initial messages
- For request/response patterns, we use current_request_msg as parent
- Fall back to execute_msg for notifications during execution
"""
function _send_msg(comm::PositronComm, data::Any, metadata::Union{Dict,Nothing})
    if comm.kernel === nothing
        kernel_log_info("Warning: No IJulia comm attached")
        return
    end

    kernel_log_info("Sending comm message: $(comm.comm_id), target=$(comm.target_name), type=$(typeof(data))")

    # Convert to Dict (IJulia expects Dict, not JSON3.Object)
    json_str = JSON3.write(data)
    # Log truncated message (avoid logging large plot data)
    if length(json_str) > 500
        kernel_log_info("Message JSON (truncated): $(first(json_str, 200))...$(last(json_str, 100)) ($(length(json_str)) bytes)")
    else
        kernel_log_info("Message JSON: $json_str")
    end
    data_dict = JSON3.read(json_str, Dict{String,Any})

    # Get the IJulia kernel
    ijulia_kernel = isdefined(IJulia, :kernel) ? IJulia.kernel : IJulia._default_kernel

    try
        # Determine which parent message to use
        parent_msg = nothing
        parent_type = ""

        if comm.comm_open_msg !== nothing
            # Initial send during comm_open
            parent_msg = comm.comm_open_msg
            parent_type = "comm_open"
            # Clear comm_open_msg after first use
            comm.comm_open_msg = nothing
        elseif comm.current_request_msg !== nothing
            # Response to an incoming request
            parent_msg = comm.current_request_msg
            parent_type = "request"
        end

        if parent_msg !== nothing
            kernel_log_info("Using $parent_type message as parent for comm response")
            # Log parent message details for debugging
            if hasfield(typeof(parent_msg), :header) && parent_msg.header !== nothing
                parent_header = parent_msg.header
                request_msg_id = get(parent_header, "msg_id", "N/A")
                kernel_log_info("Request header.msg_id=$(request_msg_id) (this must match frontend's pending RPC key)")
            else
                kernel_log_warn("Parent message has no header!")
            end
            # Build message manually with the correct parent.
            # The frontend matches RPC responses using parent_header.msg_id.
            response_comm_id = comm.kernel.id
            content = Dict("comm_id" => response_comm_id, "data" => data_dict)
            kernel_log_info("Response comm_id=$(response_comm_id) (PositronComm.comm_id=$(comm.comm_id))")
            if response_comm_id != comm.comm_id
                kernel_log_error("comm_id mismatch in response")
            end
            kernel_log_info("Response data has keys: $(collect(keys(data_dict)))")

            # Verify JSON-RPC response structure
            if haskey(data_dict, "result") || haskey(data_dict, "error")
                jsonrpc_id = get(data_dict, "id", "MISSING")
                kernel_log_info("JSON-RPC response: id=$(jsonrpc_id), has_result=$(haskey(data_dict, "result")), has_error=$(haskey(data_dict, "error"))")
            else
                kernel_log_warn("JSON-RPC response missing 'result' and 'error' keys! Keys present: $(collect(keys(data_dict)))")
            end

            msg = IJulia.msg_pub(parent_msg, "comm_msg", content)
            kernel_log_info("Response parent_header.msg_id=$(msg.parent_header["msg_id"]) (must match request_msg_id)")
            kernel_log_info("Response header.msg_id=$(msg.header["msg_id"]) (new message ID)")
            IJulia.send_ipython(ijulia_kernel.publish[], ijulia_kernel, msg)
            kernel_log_info("Message sent on IOPub channel")
        else
            # Fall back to execute_msg for notifications during code execution
            # NOTE: This won't work for RPC responses! But it's ok for events.
            kernel_log_info("No parent message, using send_comm fallback (events only)")
            IJulia.send_comm(comm.kernel, data_dict; kernel = ijulia_kernel)
            kernel_log_info("Message sent via send_comm")
        end
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
    # Hook into IJulia's pre-execute callback to ensure display stack is correct
    if isdefined(IJulia, :push_preexecute_hook)
        IJulia.push_preexecute_hook(() -> on_pre_execute(kernel))
    elseif isdefined(IJulia, :_preexecute_hooks)
        push!(IJulia._preexecute_hooks, () -> on_pre_execute(kernel))
    end

    # Hook into IJulia's post-execute callback
    if isdefined(IJulia, :push_postexecute_hook)
        IJulia.push_postexecute_hook(() -> on_post_execute(kernel))
    elseif isdefined(IJulia, :_postexecute_hooks)
        push!(IJulia._postexecute_hooks, () -> on_post_execute(kernel))
    end

    # Hook into display system for plots (handled by PlotsService)
    setup_display_hooks!(kernel)
end

"""
Called before each code execution.
"""
function on_pre_execute(kernel::PositronKernel)
    try
        # Re-fix displays to ensure PositronDisplay is at top of stack
        # This catches cases where other code modified the display stack
        fix_displays!(kernel.plots)

        # Try to install Plots.jl display_dict override if Plots.jl was loaded after init
        # This handles the case where user does `using Plots` after kernel starts
        override_plots_display_dict!()
    catch e
        kernel_log_warn("Error in pre-execute hook: $e")
    end
end

"""
Called after each code execution.
"""
function on_post_execute(kernel::PositronKernel)
    try
        # On first execution, send full refresh (initial population)
        # After that, send updates (changes only)
        if kernel.variables.current_version == 0
            kernel_log("First execution - sending initial refresh")
            send_refresh!(kernel.variables)
        else
            # Normal update (changes only)
            send_update!(kernel.variables)
        end
    catch e
        kernel_log_error("Error in post-execute hook: $e")
    end
end

"""
Set up display hooks for capturing plots.

This is now handled by PlotsService.init!() which installs PositronDisplay.
The display is re-fixed before each execution via on_pre_execute.
"""
function setup_display_hooks!(kernel::PositronKernel)
    # Nothing to do here - PositronDisplay is installed by init!(kernel.plots)
    # and is refreshed before each execution via fix_displays!
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

# -------------------------------------------------------------------------
# Custom is_complete_request handler
# -------------------------------------------------------------------------

"""
Determine if a code fragment is complete, incomplete, or invalid.

This replaces IJulia's default is_complete_request handler to properly handle
multi-line code with multiple expressions. The default handler uses Meta.parse
which only handles single expressions, causing multi-expression code like:

    x = 1
    y = 2

to be reported as "invalid" (since Meta.parse sees "extra token after end of expression").

This implementation uses Meta.parseall which correctly handles multiple expressions
and checks if any of them are incomplete.
"""
function check_code_complete(code::String)
    try
        ex = Meta.parseall(code)

        # Check if any expression in the toplevel block is incomplete
        for arg in ex.args
            if Meta.isexpr(arg, :incomplete)
                return "incomplete"
            elseif Meta.isexpr(arg, :error)
                return "invalid"
            end
        end

        return "complete"
    catch e
        # If parsing throws an exception, the code is invalid
        kernel_log_warn("Error parsing code for completeness check: $e")
        return "invalid"
    end
end

"""
Install our custom is_complete_request handler in IJulia.
This must be called after IJulia is loaded.
"""
function install_is_complete_handler!()
    if !isdefined(IJulia, :handlers)
        kernel_log_warn("IJulia.handlers not found, cannot install custom is_complete handler")
        return
    end

    # Replace the default handler with our custom one
    IJulia.handlers["is_complete_request"] = function (socket, kernel, msg)
        code = msg.content["code"]::String
        status = check_code_complete(code)

        kernel_log_info("is_complete_request: status=$status for code length=$(length(code))")

        IJulia.send_ipython(
            kernel.requests[],
            kernel,
            IJulia.msg_reply(msg, "is_complete_reply", Dict("status" => status, "indent" => "")),
        )
    end

    kernel_log_info("Installed custom is_complete_request handler")
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

# -------------------------------------------------------------------------
# UI Notifications
# -------------------------------------------------------------------------

"""
Show a message notification in the Positron UI.

This displays a toast notification in the bottom right corner of the IDE.
Useful for informing users about important events or errors.

# Arguments
- `message::String`: The message to display in the notification.

# Examples
```julia
Positron.show_ui_message("Data import completed successfully!")
Positron.show_ui_message("Warning: Large dataset may take time to process")
```
"""
function show_ui_message(message::String)
    kernel = get_kernel()
    if !kernel.started
        kernel_log_warn("Positron services not started, cannot show UI message")
        return
    end

    show_message!(kernel.ui, message)
end

"""
Test function to verify UI notifications work correctly.

This function sends a test notification to the Positron UI.
You should see a toast notification appear in the bottom right corner.

Call with: Positron.test_ui_notification()
"""
function test_ui_notification()
    kernel_log_info("Testing UI notification - sending message to Positron UI")
    show_ui_message("Test notification from Julia kernel! If you see this popup, UI notifications work correctly.")
    kernel_log_info("UI notification sent - check for toast notification in bottom right")
end
