# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Positron comm wrapper providing JSON-RPC interface over Jupyter comms.
"""

using IJulia

"""
A wrapper around a Jupyter comm that provides JSON-RPC messaging.

This is similar to Python's PositronComm class.
"""
mutable struct PositronComm
    comm_id::String
    target_name::String
    kernel::Any  # IJulia kernel reference
    msg_handler::Union{Function,Nothing}
    close_handler::Union{Function,Nothing}
    send_lock::ReentrantLock
    comm_open_msg::Any  # Store comm_open message to use as parent for initial sends
    current_request_id::Union{String,Int,Nothing}  # ID of current request being processed
    current_request_msg::Any  # Store incoming request message to use as parent for response

    function PositronComm(target_name::String, comm_id::String = string(uuid4()))
        new(comm_id, target_name, nothing, nothing, nothing, ReentrantLock(), nothing, nothing, nothing)
    end
end

"""
Create and open a new Positron comm.
"""
function create_comm(target_name::String; comm_id::String = string(uuid4()))
    comm = PositronComm(target_name, comm_id)
    return comm
end

"""
Register a message handler for this comm.
"""
function on_msg!(comm::PositronComm, handler::Function)
    comm.msg_handler = handler
end

"""
Register a close handler for this comm.
"""
function on_close!(comm::PositronComm, handler::Function)
    comm.close_handler = handler
end

"""
Handle an incoming message on this comm.
"""
function handle_msg(comm::PositronComm, msg::Dict)
    if comm.msg_handler !== nothing
        # Extract and store the request ID for use in responses
        comm.current_request_id = get(msg, "id", nothing)

        try
            lock(comm.send_lock) do
                comm.msg_handler(msg)
            end
        catch e
            kernel_log_error("Error handling comm message: $(sprint(showerror, e, catch_backtrace()))")
            send_error(
                comm,
                JsonRpcErrorCode.INTERNAL_ERROR,
                "Internal error: $(sprint(showerror, e))",
            )
        finally
            # Clear the request ID after handling
            comm.current_request_id = nothing
        end
    end
end

"""
Send a JSON-RPC result to the frontend.
"""
function send_result(
    comm::PositronComm,
    data::Any = nothing;
    metadata::Union{Dict,Nothing} = nothing,
)
    result = JsonRpcResult(comm.current_request_id, data)
    _send_msg(comm, result, metadata)
end

"""
Send a JSON-RPC event (notification) to the frontend.
"""
function send_event(comm::PositronComm, name::String, payload::Any)
    notification = JsonRpcNotification(name, payload)
    lock(comm.send_lock) do
        _send_msg(comm, notification, nothing)
    end
end

"""
Send a JSON-RPC error to the frontend.
"""
function send_error(comm::PositronComm, code::Int, message::String)
    error_msg = JsonRpcError(comm.current_request_id, code, message)
    _send_msg(comm, error_msg, nothing)
end

# Note: _send_msg is implemented in kernel.jl to integrate with IJulia

"""
Open the comm (send comm_open to frontend).

This creates an IJulia.Comm with primary=true, which sends comm_open to the frontend.
The frontend will then create the corresponding comm on its side.
"""
function open!(comm::PositronComm; data::Dict = Dict())
    kernel_log_info("Opening comm: comm_id=$(comm.comm_id), target=$(comm.target_name)")

    # Create IJulia comm with primary=true to send comm_open to frontend
    # This is the kernel-initiated comm pattern (like Python's PositronComm.create)
    ijulia_kernel = isdefined(IJulia, :kernel) ? IJulia.kernel : IJulia._default_kernel

    ijulia_comm = IJulia.Comm(
        comm.target_name,
        comm.comm_id,
        true;  # primary=true sends comm_open
        kernel = ijulia_kernel,
        data = data,
    )

    # Set up message handlers
    ijulia_comm.on_msg = function (msg)
        kernel_log_info("Received comm message on $(comm.target_name): comm_id=$(comm.comm_id)")
        comm.current_request_msg = msg
        content = msg.content
        msg_data = get(content, "data", Dict())
        kernel_log_info("Message data: $msg_data")
        handle_msg(comm, msg_data)
        comm.current_request_msg = nothing
    end

    ijulia_comm.on_close = function (msg)
        if comm.close_handler !== nothing
            comm.close_handler()
        end
    end

    # Store the IJulia comm for sending messages
    comm.kernel = ijulia_comm

    kernel_log_info("Comm opened successfully: $(comm.comm_id)")
end

"""
Close the comm.
"""
function close!(comm::PositronComm)
    kernel_log_info("Closing comm: comm_id=$(comm.comm_id)")

    if comm.close_handler !== nothing
        comm.close_handler()
    end

    # Send comm_close message via IJulia
    if comm.kernel !== nothing && isdefined(IJulia.CommManager, :close_comm)
        try
            IJulia.CommManager.close_comm(comm.kernel)
        catch e
            kernel_log_warn("Error sending comm_close: $e")
        end
    end
end
