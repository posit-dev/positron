# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
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
	msg_handler::Union{Function, Nothing}
	close_handler::Union{Function, Nothing}
	send_lock::ReentrantLock

	function PositronComm(target_name::String, comm_id::String=string(uuid4()))
		new(comm_id, target_name, nothing, nothing, nothing, ReentrantLock())
	end
end

"""
Create and open a new Positron comm.
"""
function create_comm(target_name::String; comm_id::String=string(uuid4()))
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
		try
			lock(comm.send_lock) do
				comm.msg_handler(msg)
			end
		catch e
			@error "Error handling comm message" exception=(e, catch_backtrace())
			send_error(comm, JsonRpcErrorCode.INTERNAL_ERROR, "Internal error: $(sprint(showerror, e))")
		end
	end
end

"""
Send a JSON-RPC result to the frontend.
"""
function send_result(comm::PositronComm, data::Any=nothing; metadata::Union{Dict, Nothing}=nothing)
	result = JsonRpcResult(data)
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
	error_msg = JsonRpcError(code, message)
	_send_msg(comm, error_msg, nothing)
end

# Note: _send_msg is implemented in kernel.jl to integrate with IJulia

"""
Open the comm (send comm_open to frontend).
"""
function open!(comm::PositronComm)
	# TODO: Send comm_open message via IJulia
	@debug "Opening comm" comm_id=comm.comm_id target=comm.target_name
end

"""
Close the comm.
"""
function close!(comm::PositronComm)
	if comm.close_handler !== nothing
		comm.close_handler()
	end
	# TODO: Send comm_close message via IJulia
	@debug "Closing comm" comm_id=comm.comm_id
end
