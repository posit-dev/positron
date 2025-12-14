# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Positron.jl - Julia integration for Positron IDE

This module provides the comm-based services for Positron IDE features:
- Variables: Browse and inspect variables in the Julia session
- Help: Display help documentation
- Plots: Display and manage plots
- Data Explorer: Explore tabular data (DataFrames, etc.)

The services communicate with Positron via Jupyter comms using JSON-RPC.
"""
module Positron

using JSON3
using StructTypes
using UUIDs
using Dates
using Base64
using Markdown
using Statistics  # For mean, std, quantile in Data Explorer

# Core comm infrastructure
include("jsonrpc.jl")
include("comm.jl")

# Generated comm types (from OpenRPC schemas)
include("variables_comm.jl")
include("help_comm.jl")
include("plot_comm.jl")
include("data_explorer_comm.jl")
include("ui_comm.jl")
include("connections_comm.jl")

# Service implementations
include("variables.jl")
include("help.jl")
include("plots.jl")
include("data_explorer.jl")
include("ui.jl")

# Main integration
include("kernel.jl")

# Exports - Kernel management
export PositronKernel, get_kernel, start_services!, stop_services!

# Exports - User-facing functions
export view, showhelp

# Exports - Services (for advanced usage)
export VariablesService, HelpService, PlotsService, DataExplorerService, UIService

# Exports - Comm types (for testing)
export PositronComm, create_comm, on_msg!, on_close!, send_result, send_event, send_error

end # module Positron
