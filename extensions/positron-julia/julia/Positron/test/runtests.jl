# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Main test runner for Positron.jl

This file is executed by `Pkg.test()` and runs all test suites.
Individual test files can also be run directly for faster iteration during development.

Usage:
    # Run all tests
    julia> using Pkg; Pkg.test("Positron")

    # Or from shell
    \$ julia --project=. -e 'using Pkg; Pkg.test()'

    # Run specific test file during development
    julia> include("test/test_variables.jl")
"""

using Test
using Positron

# Load test helpers once (avoid multiple includes causing method redefinition warnings)
include("test_helpers.jl")

@testset verbose = true "Positron.jl Test Suite" begin
    @testset "JSON-RPC Communication" begin
        include("test_jsonrpc.jl")
    end

    @testset "Kernel Functionality" begin
        include("test_kernel.jl")
    end

    @testset "Variables and Inspection" begin
        include("test_variables.jl")
        include("test_inspectors.jl")
    end

    @testset "Data Explorer" begin
        include("test_data_explorer.jl")
    end

    @testset "Help System" begin
        include("test_help.jl")
    end

    @testset "Plots System" begin
        include("test_plots.jl")
    end
end
