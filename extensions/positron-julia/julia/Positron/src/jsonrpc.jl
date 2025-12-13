# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
JSON-RPC 2.0 protocol implementation for Positron comms.
"""

# JSON-RPC error codes (from spec: https://www.jsonrpc.org/specification#error_object)
module JsonRpcErrorCode
	const PARSE_ERROR = -32700       # Invalid JSON received
	const INVALID_REQUEST = -32600   # Invalid Request object
	const METHOD_NOT_FOUND = -32601  # Method not available
	const INVALID_PARAMS = -32602    # Invalid method parameters
	const INTERNAL_ERROR = -32603    # Internal error
end

"""
A JSON-RPC request message.
"""
struct JsonRpcRequest
	jsonrpc::String
	method::String
	params::Any
	id::Union{String, Int, Nothing}
end

StructTypes.StructType(::Type{JsonRpcRequest}) = StructTypes.Struct()

"""
A JSON-RPC response with a result.
"""
struct JsonRpcResult
	jsonrpc::String
	result::Any
end

function JsonRpcResult(result::Any)
	JsonRpcResult("2.0", result)
end

StructTypes.StructType(::Type{JsonRpcResult}) = StructTypes.Struct()

"""
A JSON-RPC error response.
"""
struct JsonRpcError
	jsonrpc::String
	error::Dict{String, Any}
end

function JsonRpcError(code::Int, message::String)
	JsonRpcError("2.0", Dict("code" => code, "message" => message))
end

StructTypes.StructType(::Type{JsonRpcError}) = StructTypes.Struct()

"""
A JSON-RPC notification (event) message.
"""
struct JsonRpcNotification
	jsonrpc::String
	method::String
	params::Any
end

function JsonRpcNotification(method::String, params::Any)
	JsonRpcNotification("2.0", method, params)
end

StructTypes.StructType(::Type{JsonRpcNotification}) = StructTypes.Struct()

"""
Parse a JSON-RPC message from JSON data.
"""
function parse_jsonrpc(data::Dict)
	if haskey(data, "method")
		# It's a request or notification
		return JsonRpcRequest(
			get(data, "jsonrpc", "2.0"),
			data["method"],
			get(data, "params", nothing),
			get(data, "id", nothing)
		)
	else
		error("Unknown JSON-RPC message format")
	end
end
