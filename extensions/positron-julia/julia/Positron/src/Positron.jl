# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
using DataFrames
using PrecompileTools: @setup_workload, @compile_workload

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
export view, showhelp, show_ui_message

# Exports - Test functions
export test_error_logging, test_ui_notification

# Exports - Services (for advanced usage)
export VariablesService, HelpService, PlotsService, DataExplorerService, UIService

# Exports - Comm types (for testing)
export PositronComm, create_comm, on_msg!, on_close!, send_result, send_event, send_error

# Precompilation workload to reduce first-use latency
@setup_workload begin
    # Create test data during precompile setup
    test_df = DataFrame(
        int_col = [1, 2, 3, 4, 5],
        float_col = [1.1, 2.2, 3.3, 4.4, 5.5],
        string_col = ["a", "b", "c", "d", "e"],
        bool_col = [true, false, true, false, true],
    )

    @compile_workload begin
        # Exercise data explorer hot paths
        instance = DataExplorerInstance(test_df, "precompile_test")

        # Shape and column operations
        get_shape(test_df)
        for i = 1:4
            get_column_vector(test_df, i)
            get_column_name(test_df, i)
            get_column_type(test_df, i)
            get_column_schema(test_df, i)
        end

        # Cell and formatting
        format_opts = FormatOptions(2, 4, 7, 1000, nothing)
        for row = 1:3, col = 1:4
            val = get_cell_value(test_df, row, col)
            format_value(val, format_opts)
        end

        # Statistics and histograms
        compute_number_stats([1.0, 2.0, 3.0, 4.0, 5.0])
        compute_string_stats(["a", "b", "c"])
        compute_boolean_stats([true, false, true])

        hist_params = ColumnHistogramParams(
            ColumnHistogramParamsMethod_Fixed,
            5,
            nothing,
        )
        compute_histogram(instance, 1, hist_params)

        freq_params = ColumnFrequencyTableParams(10)
        compute_frequency_table(instance, 3, freq_params)

        # Sorting
        instance.sort_keys = [ColumnSortKey(0, true)]
        apply_sorting!(instance)
        update_view_indices!(instance)

        # Request parsing
        parse_format_options(Dict{String,Any}())
        parse_array_selection(Dict("first_index" => 0, "last_index" => 10))
        parse_column_selection(Dict(
            "column_index" => 0,
            "spec" => Dict("first_index" => 0, "last_index" => 10),
        ))
        parse_table_selection(Dict(
            "kind" => "single_cell",
            "selection" => Dict("row_index" => 0, "column_index" => 0),
        ))

        # JSON serialization
        state = BackendState(
            "test",
            TableShape(5, 4),
            TableShape(5, 4),
            false,
            ColumnFilter[],
            RowFilter[],
            ColumnSortKey[],
            get_supported_features(),
            nothing,
            nothing,
        )
        JSON3.write(state)
    end
end

end # module Positron
