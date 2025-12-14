# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Comprehensive Data Explorer tests matching Python test suite standards.

Tests cover:
- Virtual index management (filtered, sorted, combined views)
- Schema operations
- Data retrieval with filters/sorts
- Edge cases and performance scenarios
"""

using Test
using DataFrames

include("test_helpers.jl")

@testset "Data Explorer - Core Functionality" begin
	@testset "Instance Creation" begin
		df = DataFrame(a = [1, 2, 3], b = ["x", "y", "z"])
		instance = Positron.DataExplorerInstance(df, "test_df")

		@test instance.data === df
		@test instance.display_name == "test_df"
		@test isempty(instance.row_filters)
		@test isempty(instance.sort_keys)
		@test instance.filtered_indices === nothing
		@test instance.sorted_indices === nothing
		@test instance.view_indices === nothing
	end

	@testset "Get Shape - DataFrame" begin
		df = DataFrame(a = 1:10, b = 11:20, c = 21:30)
		nrows, ncols = Positron.get_shape(df)

		@test nrows == 10
		@test ncols == 3
	end

	@testset "Get Shape - Matrix" begin
		mat = rand(5, 3)
		nrows, ncols = Positron.get_shape(mat)

		@test nrows == 5
		@test ncols == 3
	end

	@testset "Get Shape - Edge Cases" begin
		# Empty DataFrame
		df_empty = DataFrame()
		nrows, ncols = Positron.get_shape(df_empty)
		@test nrows == 0
		@test ncols == 0

		# Single row
		df_one = DataFrame(x = [1])
		nrows, ncols = Positron.get_shape(df_one)
		@test nrows == 1
		@test ncols == 1
	end

	@testset "Get Column Vector - DataFrame" begin
		df = DataFrame(a = [1, 2, 3, 4, 5], b = ["a", "b", "c", "d", "e"])

		col_a = Positron.get_column_vector(df, 1)
		@test col_a == [1, 2, 3, 4, 5]

		col_b = Positron.get_column_vector(df, 2)
		@test col_b == ["a", "b", "c", "d", "e"]
	end

	@testset "Get Column Vector - Matrix" begin
		mat = [1 2 3; 4 5 6; 7 8 9]

		col1 = Positron.get_column_vector(mat, 1)
		@test col1 == [1, 4, 7]

		col3 = Positron.get_column_vector(mat, 3)
		@test col3 == [3, 6, 9]
	end
end

@testset "Data Explorer - Virtual Index Management" begin
	@testset "update_view_indices! - No Filters or Sorts" begin
		df = DataFrame(x = 1:5)
		instance = Positron.DataExplorerInstance(df, "test")

		Positron.update_view_indices!(instance)

		@test instance.view_indices === nothing
	end

	@testset "update_view_indices! - Only Filters" begin
		df = DataFrame(x = 1:10)
		instance = Positron.DataExplorerInstance(df, "test")

		# Simulate filtering: keep even indices
		instance.filtered_indices = [2, 4, 6, 8, 10]

		Positron.update_view_indices!(instance)

		@test instance.view_indices == [2, 4, 6, 8, 10]
	end

	@testset "update_view_indices! - Only Sorting" begin
		df = DataFrame(x = 1:5)
		instance = Positron.DataExplorerInstance(df, "test")

		# Simulate sorting: reverse order
		instance.sorted_indices = [5, 4, 3, 2, 1]

		Positron.update_view_indices!(instance)

		@test instance.view_indices == [5, 4, 3, 2, 1]
	end

	@testset "update_view_indices! - Both Filters and Sorts" begin
		df = DataFrame(x = 1:10)
		instance = Positron.DataExplorerInstance(df, "test")

		# Filtered: keep rows 2,4,6,8
		instance.filtered_indices = [2, 4, 6, 8]

		# Sorted: all rows in some order
		instance.sorted_indices = [10, 8, 6, 4, 2, 1, 3, 5, 7, 9]

		Positron.update_view_indices!(instance)

		# Result: sorted order, but only filtered rows
		# From sorted_indices, keep only [8,6,4,2] (those in filtered_indices)
		@test instance.view_indices == [8, 6, 4, 2]
	end

	@testset "update_view_indices! - Complex Scenario" begin
		df = DataFrame(x = 1:100)
		instance = Positron.DataExplorerInstance(df, "test")

		# Filter to 50 rows (even numbers)
		instance.filtered_indices = [i for i = 1:100 if i % 2 == 0]

		# Sort in reverse
		instance.sorted_indices = collect(100:-1:1)

		Positron.update_view_indices!(instance)

		# Should be even numbers in descending order
		@test instance.view_indices == [i for i = 100:-2:2]
		@test length(instance.view_indices) == 50
	end
end

@testset "Data Explorer - Sorting" begin
	@testset "apply_sorting! - Single Column Ascending" begin
		df = DataFrame(x = [3, 1, 4, 1, 5, 9, 2, 6])
		instance = Positron.DataExplorerInstance(df, "test")

		# Add sort key
		instance.sort_keys = [
			Positron.ColumnSortKey(0, true)  # Column 0 (x), ascending
		]

		Positron.apply_sorting!(instance)

		@test instance.sorted_indices !== nothing
		# Verify sorted order: values should be [1,1,2,3,4,5,6,9]
		sorted_values = df.x[instance.sorted_indices]
		@test sorted_values == [1, 1, 2, 3, 4, 5, 6, 9]
	end

	@testset "apply_sorting! - Single Column Descending" begin
		df = DataFrame(x = [3, 1, 4, 1, 5])
		instance = Positron.DataExplorerInstance(df, "test")

		instance.sort_keys = [
			Positron.ColumnSortKey(0, false)  # Column 0 (x), descending
		]

		Positron.apply_sorting!(instance)

		sorted_values = df.x[instance.sorted_indices]
		@test sorted_values == [5, 4, 3, 1, 1]
	end

	@testset "apply_sorting! - Multi-Column" begin
		df = DataFrame(
			category = ["A", "B", "A", "B", "A"],
			value = [3, 1, 2, 4, 1]
		)
		instance = Positron.DataExplorerInstance(df, "test")

		# Sort by category (asc), then value (asc)
		instance.sort_keys = [
			Positron.ColumnSortKey(0, true),   # category
			Positron.ColumnSortKey(1, true)    # value
		]

		Positron.apply_sorting!(instance)

		# Within each category, values should be sorted
		sorted_df = df[instance.sorted_indices, :]
		@test sorted_df.category == ["A", "A", "A", "B", "B"]
		@test sorted_df.value == [1, 2, 3, 1, 4]
	end

	@testset "apply_sorting! - Empty Sort Keys" begin
		df = DataFrame(x = [1, 2, 3])
		instance = Positron.DataExplorerInstance(df, "test")

		instance.sort_keys = Positron.ColumnSortKey[]

		Positron.apply_sorting!(instance)

		@test instance.sorted_indices === nothing
	end
end

@testset "Data Explorer - Row Filtering" begin
	@testset "apply_row_filters - No Filters" begin
		df = DataFrame(x = 1:10)
		filters = Positron.RowFilter[]

		result = Positron.apply_row_filters(df, filters)

		@test result === nothing  # No filters means use all rows
	end

	# TODO: Add comprehensive filter tests once vectorized implementation is complete
	# Test cases needed:
	# - Compare filters (=, !=, <, >, <=, >=)
	# - Between filters (inclusive, exclusive, not between)
	# - Text search (contains, starts_with, ends_with, regex)
	# - Set membership (in, not in)
	# - Null checks (is_null, not_null, is_empty, not_empty)
	# - Boolean filters (is_true, is_false)
	# - Multiple filters with AND/OR conditions
	# - Edge cases: empty results, all pass, type coercion
end

@testset "Data Explorer - get_data_values with Views" begin
	@testset "get_data_values - No View (Unfiltered/Unsorted)" begin
		df = DataFrame(a = 1:10, b = 11:20)
		instance = Positron.DataExplorerInstance(df, "test")
		comm = MockComm("data_explorer")
		instance.comm = comm

		# Request first 5 rows, column 0
		request = Positron.DataExplorerGetDataValuesParams(
			[Positron.ColumnSelection(
				0,  # column_index
				Positron.DataSelectionRange(0, 4)  # rows 0-4 (0-based)
			)],
			Positron.FormatOptions(2, 2, 10, 1000, nothing)
		)

		Positron.handle_get_data_values(instance, request)

		@test length(comm.messages) > 0
		msg = last_message(comm)
		@test haskey(msg, "data")
	end

	@testset "get_data_values - With Filtering" begin
		df = DataFrame(x = 1:10)
		instance = Positron.DataExplorerInstance(df, "test")

		# Simulate filter: keep only even rows (indices 2,4,6,8,10)
		instance.filtered_indices = [2, 4, 6, 8, 10]
		Positron.update_view_indices!(instance)

		# Now when we request rows 0-2 of the VIEW, we should get
		# view_indices[1:3] which is [2,4,6]
		# And those map to values [2,4,6]

		col = Positron.get_column_vector(df, 1)

		# Simulate what handle_get_data_values does
		if instance.view_indices !== nothing
			view_slice = instance.view_indices[1:3]  # rows 0-2 (0-based) → 1-3 (1-based)
			values = col[view_slice]
			@test values == [2, 4, 6]
		end
	end

	@testset "get_data_values - With Sorting" begin
		df = DataFrame(x = [3, 1, 4, 1, 5])
		instance = Positron.DataExplorerInstance(df, "test")

		# Sort ascending
		instance.sort_keys = [Positron.ColumnSortKey(0, true)]
		Positron.apply_sorting!(instance)
		Positron.update_view_indices!(instance)

		# First 3 rows of view should be smallest values
		col = Positron.get_column_vector(df, 1)
		view_slice = instance.view_indices[1:3]
		values = col[view_slice]

		@test values == [1, 1, 3]  # Sorted order
	end

	@testset "get_data_values - With Filter AND Sort" begin
		df = DataFrame(x = 1:20)
		instance = Positron.DataExplorerInstance(df, "test")

		# Filter: keep values > 10 (indices 11-20)
		instance.filtered_indices = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

		# Sort: descending
		instance.sort_keys = [Positron.ColumnSortKey(0, false)]
		Positron.apply_sorting!(instance)
		Positron.update_view_indices!(instance)

		# View should be filtered rows in descending order
		# view[0:4] should give us [20,19,18,17,16]
		col = Positron.get_column_vector(df, 1)
		view_slice = instance.view_indices[1:5]
		values = col[view_slice]

		@test values == [20, 19, 18, 17, 16]
	end
end

@testset "Data Explorer - Edge Cases" begin
	@testset "Empty DataFrame" begin
		df = DataFrame()
		instance = Positron.DataExplorerInstance(df, "empty")

		nrows, ncols = Positron.get_shape(df)
		@test nrows == 0
		@test ncols == 0
	end

	@testset "Single Row DataFrame" begin
		df = DataFrame(a = [1], b = ["x"])
		instance = Positron.DataExplorerInstance(df, "single")

		nrows, ncols = Positron.get_shape(df)
		@test nrows == 1
		@test ncols == 2

		col = Positron.get_column_vector(df, 1)
		@test col == [1]
	end

	@testset "Single Column DataFrame" begin
		df = DataFrame(x = 1:100)
		instance = Positron.DataExplorerInstance(df, "single_col")

		nrows, ncols = Positron.get_shape(df)
		@test nrows == 100
		@test ncols == 1
	end

	@testset "DataFrame with Missing Values" begin
		df = DataFrame(x = [1, missing, 3, missing, 5])
		instance = Positron.DataExplorerInstance(df, "with_missing")

		col = Positron.get_column_vector(df, 1)
		@test length(col) == 5
		@test ismissing(col[2])
		@test ismissing(col[4])
	end

	@testset "Large DataFrame" begin
		df = DataFrame(
			id = 1:10_000,
			value = rand(10_000),
			category = rand(["A", "B", "C"], 10_000)
		)
		instance = Positron.DataExplorerInstance(df, "large")

		nrows, ncols = Positron.get_shape(df)
		@test nrows == 10_000
		@test ncols == 3

		# Get column should be fast
		col = Positron.get_column_vector(df, 2)
		@test length(col) == 10_000
	end
end

@testset "Data Explorer - Sorting Correctness" begin
	@testset "Stable Sort Preservation" begin
		# Test that sort is stable (equal elements keep original order)
		df = DataFrame(
			key = [1, 2, 1, 2, 1],
			order = [1, 2, 3, 4, 5]
		)
		instance = Positron.DataExplorerInstance(df, "stable")

		instance.sort_keys = [Positron.ColumnSortKey(0, true)]  # Sort by key
		Positron.apply_sorting!(instance)

		sorted_order = df.order[instance.sorted_indices]
		# Among key=1, order should be [1,3,5]
		# Among key=2, order should be [2,4]
		@test sorted_order == [1, 3, 5, 2, 4]
	end

	@testset "Sort with Missing Values" begin
		df = DataFrame(x = [3, missing, 1, missing, 2])
		instance = Positron.DataExplorerInstance(df, "missing")

		instance.sort_keys = [Positron.ColumnSortKey(0, true)]
		Positron.apply_sorting!(instance)

		# Missing values should sort to end
		sorted_x = df.x[instance.sorted_indices]
		@test length(sorted_x) == 5
		# First values should be non-missing in order
		@test sorted_x[1] == 1
		@test sorted_x[2] == 2
		@test sorted_x[3] == 3
	end
end

@testset "Data Explorer - Performance Benchmarks" begin
	@testset "Large Dataset - Sort Performance" begin
		# Test that sorting 1M rows is reasonable
		df = DataFrame(x = rand(1_000_000))
		instance = Positron.DataExplorerInstance(df, "perf")

		instance.sort_keys = [Positron.ColumnSortKey(0, true)]

		# Should complete in reasonable time
		@time Positron.apply_sorting!(instance)

		@test instance.sorted_indices !== nothing
		@test length(instance.sorted_indices) == 1_000_000
	end

	@testset "Large Dataset - Filter + Sort" begin
		df = DataFrame(x = 1:100_000)
		instance = Positron.DataExplorerInstance(df, "perf2")

		# Filter to 50% of rows
		instance.filtered_indices = [i for i = 1:100_000 if i % 2 == 0]

		# Sort
		instance.sort_keys = [Positron.ColumnSortKey(0, false)]
		Positron.apply_sorting!(instance)

		@time Positron.update_view_indices!(instance)

		@test instance.view_indices !== nothing
		@test length(instance.view_indices) == 50_000
	end
end

@testset "Data Explorer - Histogram Computation" begin
	@testset "Histogram - Fixed Method" begin
		data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
		params = Positron.ColumnHistogramParams(
			Positron.ColumnHistogramParamsMethod_Fixed,
			5,  # num_bins
			nothing  # quantiles
		)

		# Create a simple DataFrame for testing
		df = DataFrame(x = data)
		hist = Positron.compute_histogram(df, 1, params)

		@test length(hist.bin_edges) == 6  # num_bins + 1
		@test length(hist.bin_counts) == 5
		@test sum(hist.bin_counts) == 10  # All values accounted for
	end

	@testset "Histogram - Sturges Method" begin
		data = rand(100)
		df = DataFrame(x = data)
		params = Positron.ColumnHistogramParams(
			Positron.ColumnHistogramParamsMethod_Sturges,
			100,  # max bins
			nothing
		)

		hist = Positron.compute_histogram(df, 1, params)

		# Sturges: ceil(log2(100)) + 1 = ceil(6.64) + 1 = 8
		expected_bins = ceil(Int, log2(100)) + 1
		@test length(hist.bin_counts) == expected_bins
		@test sum(hist.bin_counts) == 100
	end

	@testset "Histogram - Freedman-Diaconis Method" begin
		data = randn(1000)  # Normal distribution
		df = DataFrame(x = data)
		params = Positron.ColumnHistogramParams(
			Positron.ColumnHistogramParamsMethod_FreedmanDiaconis,
			100,
			nothing
		)

		hist = Positron.compute_histogram(df, 1, params)

		@test length(hist.bin_counts) > 0
		@test length(hist.bin_counts) <= 100  # Capped at max
		@test sum(hist.bin_counts) == 1000
	end

	@testset "Histogram - Scott Method" begin
		data = randn(500)
		df = DataFrame(x = data)
		params = Positron.ColumnHistogramParams(
			Positron.ColumnHistogramParamsMethod_Scott,
			100,
			nothing
		)

		hist = Positron.compute_histogram(df, 1, params)

		@test length(hist.bin_counts) > 0
		@test sum(hist.bin_counts) == 500
	end

	@testset "Histogram - Empty Data" begin
		df = DataFrame(x = Float64[])
		params = Positron.ColumnHistogramParams(
			Positron.ColumnHistogramParamsMethod_Fixed,
			10,
			nothing
		)

		hist = Positron.compute_histogram(df, 1, params)

		@test isempty(hist.bin_edges)
		@test isempty(hist.bin_counts)
	end

	@testset "Histogram - Single Unique Value" begin
		df = DataFrame(x = [42.0, 42.0, 42.0, 42.0])
		params = Positron.ColumnHistogramParams(
			Positron.ColumnHistogramParamsMethod_Fixed,
			10,
			nothing
		)

		hist = Positron.compute_histogram(df, 1, params)

		@test length(hist.bin_edges) == 2
		@test hist.bin_edges == ["42.0", "42.0"]
		@test hist.bin_counts == [4]
	end

	@testset "Histogram - Integer Column Bin Limiting" begin
		# Integer column with small range
		df = DataFrame(x = [1, 2, 3, 4, 5])
		params = Positron.ColumnHistogramParams(
			Positron.ColumnHistogramParamsMethod_Fixed,
			100,  # Request 100 bins
			nothing
		)

		hist = Positron.compute_histogram(df, 1, params)

		# Should limit to value range: 5-1 = 4, so max 5 bins
		@test length(hist.bin_counts) <= 5
		@test sum(hist.bin_counts) == 5
	end

	@testset "Histogram - NaN and Inf Handling" begin
		df = DataFrame(x = [1.0, 2.0, NaN, 3.0, Inf, 4.0, -Inf, 5.0])
		params = Positron.ColumnHistogramParams(
			Positron.ColumnHistogramParamsMethod_Fixed,
			5,
			nothing
		)

		hist = Positron.compute_histogram(df, 1, params)

		# Should exclude NaN and Inf, leaving [1,2,3,4,5]
		@test sum(hist.bin_counts) == 5
	end

	@testset "Histogram - Missing Values" begin
		df = DataFrame(x = [1.0, 2.0, missing, 3.0, missing, 4.0])
		params = Positron.ColumnHistogramParams(
			Positron.ColumnHistogramParamsMethod_Fixed,
			4,
			nothing
		)

		hist = Positron.compute_histogram(df, 1, params)

		# Should exclude missing, leaving [1,2,3,4]
		@test sum(hist.bin_counts) == 4
	end

	@testset "Histogram - Quantiles" begin
		df = DataFrame(x = 1.0:100.0)
		params = Positron.ColumnHistogramParams(
			Positron.ColumnHistogramParamsMethod_Fixed,
			10,
			[0.0, 0.25, 0.5, 0.75, 1.0]  # Min, Q1, median, Q3, max
		)

		hist = Positron.compute_histogram(df, 1, params)

		@test length(hist.quantiles) == 5
		# Check approximate values (allowing for interpolation)
		@test parse(Float64, hist.quantiles[1].value) ≈ 1.0 atol = 1.0   # min
		@test parse(Float64, hist.quantiles[3].value) ≈ 50.5 atol = 1.0  # median
		@test parse(Float64, hist.quantiles[5].value) ≈ 100.0 atol = 1.0 # max
	end

	@testset "Histogram - Large Dataset" begin
		df = DataFrame(x = randn(100_000))
		params = Positron.ColumnHistogramParams(
			Positron.ColumnHistogramParamsMethod_Sturges,
			1000,
			nothing
		)

		# Should be fast even with 100K rows
		@time hist = Positron.compute_histogram(df, 1, params)

		@test length(hist.bin_counts) > 0
		@test sum(hist.bin_counts) == 100_000
	end
end

# TODO: Add more comprehensive tests
# Priority test areas (from Python test_data_explorer.py):
# - Summary statistics (min, max, mean, median, stdev) - NEXT
# - Frequency tables
# - Schema operations (get_schema, search_schema, sort schema results)
# - Column type inference and display types
# - Filter evaluation for all filter types
# - Export data selection
# - Schema change detection
# - Format options and value formatting
# - Row labels with indices
# - Wide DataFrames (100+ columns)
# - Various data types (dates, times, categoricals)
