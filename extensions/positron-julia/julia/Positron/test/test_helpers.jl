# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Test helpers and mocking utilities for Positron.jl tests.
"""

using UUIDs

"""
MockComm - A test double for PositronComm that captures messages.

Matches the PositronComm interface but stores all sent messages
for test assertions instead of actually sending them.
"""
mutable struct MockComm
	comm_id::String
	target_name::String
	kernel::Any
	msg_handler::Union{Function,Nothing}
	close_handler::Union{Function,Nothing}
	send_lock::ReentrantLock

	# Test-specific fields
	messages::Vector{Any}
	is_open::Bool

	function MockComm(target_name::String = "test", comm_id::String = string(uuid4()))
		new(comm_id, target_name, nothing, nothing, nothing, ReentrantLock(), [], true)
	end
end

"""
Override _send_msg for MockComm to capture messages instead of sending.
"""
function Positron._send_msg(comm::MockComm, data::Any, metadata::Union{Dict,Nothing})
	push!(comm.messages, Dict("data" => data, "metadata" => metadata))
	return nothing
end

"""
Override send_result for MockComm.
"""
function Positron.send_result(comm::MockComm, result; metadata = nothing)
	data = Positron.JsonRpcResult(result)
	Positron._send_msg(comm, data, metadata)
	return nothing
end

"""
Override send_event for MockComm.
"""
function Positron.send_event(comm::MockComm, event_name::String, params; metadata = nothing)
	data = Positron.JsonRpcNotification(event_name, params)
	Positron._send_msg(comm, data, metadata)
	return nothing
end

"""
Override send_error for MockComm.
"""
function Positron.send_error(comm::MockComm, code, message::String; metadata = nothing)
	data = Positron.JsonRpcError(code, message)
	Positron._send_msg(comm, data, metadata)
	return nothing
end

"""
Get the last message sent on a MockComm.
"""
function last_message(comm::MockComm)
	return isempty(comm.messages) ? nothing : comm.messages[end]
end

"""
Get all messages sent on a MockComm.
"""
function all_messages(comm::MockComm)
	return comm.messages
end

"""
Clear all captured messages from a MockComm.
"""
function clear_messages!(comm::MockComm)
	empty!(comm.messages)
	return nothing
end

"""
Helper to create a variable in Main for testing and clean it up afterward.
"""
macro with_test_var(name_expr, value_expr, body)
	name_sym = name_expr
	quote
		@eval Main $name_sym = $(esc(value_expr))
		try
			$(esc(body))
		finally
			# Note: Can't truly delete in Julia, but we mark as done with test
		end
	end
end
