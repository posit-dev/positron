# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

# Julia Language Server startup script for Positron
#
# This script is spawned by the positron-julia extension to provide
# LSP-based code intelligence features like completion, hover, and diagnostics.
#
# The extension sets JULIA_DEPOT_PATH to point to its own depot where
# LanguageServer.jl is installed.
#
# Usage: julia main.jl <env_path> [--debug]

# Parse command line arguments
env_path = length(ARGS) >= 1 ? ARGS[1] : pwd()
debug_mode = "--debug" in ARGS

# Try to load LanguageServer.jl
try
	@info "Starting Julia Language Server..."
	@info "  Environment: $env_path"
	@info "  Depot path: $(DEPOT_PATH)"
	@info "  Debug mode: $debug_mode"

	using LanguageServer
	using SymbolServer

	# Run the language server
	# It communicates over stdin/stdout using the LSP protocol
	runserver()
catch e
	@error "Failed to start language server" exception=(e, catch_backtrace())

	if isa(e, ArgumentError) && occursin("Package LanguageServer", string(e))
		@error """
		LanguageServer.jl is not installed in the depot.
		The Positron extension should have installed it automatically.
		Please try reloading the window or check the Julia Language Server output.
		"""
	end

	# Exit with error code
	exit(1)
end
