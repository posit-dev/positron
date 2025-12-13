# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

using Test
using Positron

# Include test files
include("test_jsonrpc.jl")
include("test_variables.jl")
include("test_data_explorer.jl")
include("test_help.jl")

@testset "Positron.jl" begin
	@testset "JSON-RPC" begin
		test_jsonrpc()
	end

	@testset "Variables" begin
		test_variables()
	end

	@testset "Data Explorer" begin
		test_data_explorer()
	end

	@testset "Help" begin
		test_help()
	end
end
