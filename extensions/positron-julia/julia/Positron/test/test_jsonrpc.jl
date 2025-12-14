# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

using Test
using JSON3

function test_jsonrpc()
    @testset "JsonRpcRequest parsing" begin
        # Test basic request parsing
        json_str = """{"jsonrpc": "2.0", "method": "test_method", "params": {"foo": "bar"}, "id": 1}"""
        data = JSON3.read(json_str)

        @test data["method"] == "test_method"
        @test data["params"]["foo"] == "bar"
        @test data["id"] == 1
    end

    @testset "JsonRpcResult serialization" begin
        # Test result serialization
        result = Positron.JsonRpcResult(Dict("value" => 42))
        json_str = JSON3.write(result)
        parsed = JSON3.read(json_str)

        @test parsed["jsonrpc"] == "2.0"
        @test parsed["result"]["value"] == 42
    end

    @testset "JsonRpcError serialization" begin
        # Test error serialization
        error = Positron.JsonRpcError(
            Positron.JsonRpcErrorCode.INVALID_PARAMS,
            "Invalid parameter",
        )
        json_str = JSON3.write(error)
        parsed = JSON3.read(json_str)

        @test parsed["jsonrpc"] == "2.0"
        @test parsed["error"]["code"] == Positron.JsonRpcErrorCode.INVALID_PARAMS
        @test parsed["error"]["message"] == "Invalid parameter"
    end

    @testset "JsonRpcNotification serialization" begin
        # Test notification serialization
        notification = Positron.JsonRpcNotification("update", Dict("status" => "complete"))
        json_str = JSON3.write(notification)
        parsed = JSON3.read(json_str)

        @test parsed["jsonrpc"] == "2.0"
        @test parsed["method"] == "update"
        @test parsed["params"]["status"] == "complete"
    end

    @testset "Error codes" begin
        @test Positron.JsonRpcErrorCode.PARSE_ERROR == -32700
        @test Positron.JsonRpcErrorCode.INVALID_REQUEST == -32600
        @test Positron.JsonRpcErrorCode.METHOD_NOT_FOUND == -32601
        @test Positron.JsonRpcErrorCode.INVALID_PARAMS == -32602
        @test Positron.JsonRpcErrorCode.INTERNAL_ERROR == -32603
    end
end
