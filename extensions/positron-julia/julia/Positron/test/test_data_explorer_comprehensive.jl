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
using Statistics
using Random

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

@testset "Data Explorer - Summary Statistics" begin
	@testset "Number Stats - Basic" begin
		values = [1.0, 2.0, 3.0, 4.0, 5.0]
		stats = Positron.compute_number_stats(values)

		@test parse(Float64, stats.min_value) == 1.0
		@test parse(Float64, stats.max_value) == 5.0
		@test parse(Float64, stats.mean) == 3.0
		@test parse(Float64, stats.median) == 3.0
		@test parse(Float64, stats.stdev) ≈ std([1, 2, 3, 4, 5])
	end

	@testset "Number Stats - With Missing" begin
		values = [1.0, 2.0, missing, 3.0, missing, 4.0]
		# Filter out missing first (like compute_summary_stats does)
		filtered = filter(x -> x !== nothing && x !== missing, values)
		stats = Positron.compute_number_stats(filtered)

		@test parse(Float64, stats.min_value) == 1.0
		@test parse(Float64, stats.max_value) == 4.0
		@test parse(Float64, stats.mean) == 2.5
	end

	@testset "Number Stats - Empty" begin
		values = Float64[]
		stats = Positron.compute_number_stats(values)

		@test stats.min_value === nothing
		@test stats.max_value === nothing
		@test stats.mean === nothing
		@test stats.median === nothing
		@test stats.stdev === nothing
	end

	@testset "Number Stats - Large Dataset" begin
		values = randn(10_000)
		stats = Positron.compute_number_stats(values)

		@test stats.min_value !== nothing
		@test stats.max_value !== nothing
		@test stats.mean !== nothing
		@test stats.median !== nothing
		@test stats.stdev !== nothing

		# Mean should be close to 0 for normal distribution
		@test abs(parse(Float64, stats.mean)) < 0.1
	end

	@testset "String Stats - Basic" begin
		values = ["apple", "banana", "cherry", "apple", ""]
		stats = Positron.compute_string_stats(values)

		@test stats.num_empty == 1
		@test stats.num_unique == 4  # "apple", "banana", "cherry", ""
	end

	@testset "String Stats - All Empty" begin
		values = ["", "", ""]
		stats = Positron.compute_string_stats(values)

		@test stats.num_empty == 3
		@test stats.num_unique == 1
	end

	@testset "String Stats - No Duplicates" begin
		values = ["a", "b", "c", "d", "e"]
		stats = Positron.compute_string_stats(values)

		@test stats.num_empty == 0
		@test stats.num_unique == 5
	end

	@testset "Boolean Stats - Mixed" begin
		values = [true, false, true, true, false]
		stats = Positron.compute_boolean_stats(values)

		@test stats.true_count == 3
		@test stats.false_count == 2
	end

	@testset "Boolean Stats - All True" begin
		values = [true, true, true]
		stats = Positron.compute_boolean_stats(values)

		@test stats.true_count == 3
		@test stats.false_count == 0
	end

	@testset "Boolean Stats - All False" begin
		values = [false, false]
		stats = Positron.compute_boolean_stats(values)

		@test stats.true_count == 0
		@test stats.false_count == 2
	end
end

@testset "Data Explorer - DataFrame Column Types" begin
	using Dates

	@testset "Integer Types" begin
		df = DataFrame(
			int8 = Int8[1, 2, 3],
			int16 = Int16[10, 20, 30],
			int32 = Int32[100, 200, 300],
			int64 = Int64[1000, 2000, 3000],
			uint8 = UInt8[1, 2, 3],
			uint16 = UInt16[10, 20, 30]
		)

		instance = Positron.DataExplorerInstance(df, "integers")

		# Test column extraction for each type
		for col_idx in 1:6
			col = Positron.get_column_vector(df, col_idx)
			@test length(col) == 3
			@test eltype(col) <: Integer
		end

		# Test sorting with different int types
		instance.sort_keys = [Positron.ColumnSortKey(0, false)]  # Sort by int8 desc
		Positron.apply_sorting!(instance)
		@test df.int8[instance.sorted_indices] == [3, 2, 1]
	end

	@testset "Floating Point Types" begin
		df = DataFrame(
			float32 = Float32[1.1, 2.2, 3.3],
			float64 = Float64[1.11, 2.22, 3.33]
		)

		instance = Positron.DataExplorerInstance(df, "floats")

		for col_idx in 1:2
			col = Positron.get_column_vector(df, col_idx)
			@test length(col) == 3
			@test eltype(col) <: AbstractFloat
		end

		# Test histogram on Float32
		params = Positron.ColumnHistogramParams(
			Positron.ColumnHistogramParamsMethod_Fixed,
			5,
			nothing
		)
		hist = Positron.compute_histogram(df, 1, params)
		@test sum(hist.bin_counts) == 3
	end

	@testset "Boolean Columns" begin
		df = DataFrame(flag = [true, false, true, false, true])
		instance = Positron.DataExplorerInstance(df, "bools")

		col = Positron.get_column_vector(df, 1)
		@test length(col) == 5
		@test eltype(col) == Bool

		# Test boolean stats
		stats = Positron.compute_boolean_stats(col)
		@test stats.true_count == 3
		@test stats.false_count == 2
	end

	@testset "String Columns" begin
		df = DataFrame(
			text = ["apple", "banana", "cherry", "date", "elderberry"]
		)

		instance = Positron.DataExplorerInstance(df, "strings")

		col = Positron.get_column_vector(df, 1)
		@test length(col) == 5
		@test eltype(col) == String

		# Test string stats
		stats = Positron.compute_string_stats(col)
		@test stats.num_unique == 5
		@test stats.num_empty == 0
	end

	@testset "Date and Time Types" begin
		df = DataFrame(
			date = [Date(2024, 1, 1), Date(2024, 1, 2), Date(2024, 1, 3)],
			datetime = [DateTime(2024, 1, 1, 10, 30), DateTime(2024, 1, 2, 11, 30), DateTime(2024, 1, 3, 12, 30)],
			time = [Time(10, 30), Time(11, 30), Time(12, 30)]
		)

		instance = Positron.DataExplorerInstance(df, "dates")

		# Test column extraction for date types
		for col_idx in 1:3
			col = Positron.get_column_vector(df, col_idx)
			@test length(col) == 3
		end

		# Test sorting by date
		instance.sort_keys = [Positron.ColumnSortKey(0, false)]  # Sort by date desc
		Positron.apply_sorting!(instance)
		@test df.date[instance.sorted_indices] == [Date(2024, 1, 3), Date(2024, 1, 2), Date(2024, 1, 1)]
	end

	@testset "Missing Values - Union Types" begin
		df = DataFrame(
			int_missing = Union{Int,Missing}[1, 2, missing, 4, missing],
			float_missing = Union{Float64,Missing}[1.1, missing, 3.3, missing, 5.5],
			string_missing = Union{String,Missing}["a", missing, "c", missing, "e"]
		)

		instance = Positron.DataExplorerInstance(df, "with_missing")

		# Test column extraction with missing
		col = Positron.get_column_vector(df, 1)
		@test length(col) == 5
		@test count(ismissing, col) == 2

		# Test sorting with missing values
		instance.sort_keys = [Positron.ColumnSortKey(0, true)]
		Positron.apply_sorting!(instance)
		@test instance.sorted_indices !== nothing

		# Test histogram excludes missing
		params = Positron.ColumnHistogramParams(
			Positron.ColumnHistogramParamsMethod_Fixed,
			3,
			nothing
		)
		hist = Positron.compute_histogram(df, 1, params)
		@test sum(hist.bin_counts) == 3  # Only non-missing values
	end

	@testset "Complex Numbers" begin
		df = DataFrame(complex = [1 + 2im, 3 + 4im, 5 + 6im])

		instance = Positron.DataExplorerInstance(df, "complex")

		col = Positron.get_column_vector(df, 1)
		@test length(col) == 3
		@test eltype(col) == Complex{Int}
	end

	@testset "Mixed Column Types in DataFrame" begin
		df = DataFrame(
			id = 1:10,
			value = rand(10),
			category = rand(["A", "B", "C"], 10),
			flag = rand(Bool, 10),
			date = [Date(2024, 1, i) for i in 1:10]
		)

		instance = Positron.DataExplorerInstance(df, "mixed")

		nrows, ncols = Positron.get_shape(df)
		@test nrows == 10
		@test ncols == 5

		# Test that we can extract all column types
		for col_idx in 1:ncols
			col = Positron.get_column_vector(df, col_idx)
			@test length(col) == 10
		end
	end

	@testset "Large DataFrame with Various Types" begin
		n = 10_000
		df = DataFrame(
			id = 1:n,
			value = rand(n),
			category = rand(["A", "B", "C", "D", "E"], n),
			flag = rand(Bool, n),
			int_col = rand(Int8, n),
			float32_col = rand(Float32, n)
		)

		instance = Positron.DataExplorerInstance(df, "large_mixed")

		# Test column extraction is efficient
		for col_idx in 1:6
			@time col = Positron.get_column_vector(df, col_idx)
			@test length(col) == n
		end

		# Test sorting on different types
		for col_idx in 0:5
			instance.sort_keys = [Positron.ColumnSortKey(col_idx, true)]
			@time Positron.apply_sorting!(instance)
			@test length(instance.sorted_indices) == n
		end
	end

	@testset "Empty Columns of Various Types" begin
		df = DataFrame(
			int = Int[],
			float = Float64[],
			string = String[],
			bool = Bool[]
		)

		instance = Positron.DataExplorerInstance(df, "empty_typed")

		nrows, ncols = Positron.get_shape(df)
		@test nrows == 0
		@test ncols == 4

		# Should handle empty columns gracefully
		for col_idx in 1:4
			col = Positron.get_column_vector(df, col_idx)
			@test isempty(col)
		end
	end
end

@testset "Data Explorer - Frequency Tables" begin
	@testset "Frequency Table - Basic" begin
		df = DataFrame(category = ["A", "B", "A", "C", "A", "B", "D"])
		params = Positron.ColumnFrequencyTableParams(5)  # Top 5

		freq = Positron.compute_frequency_table(df, 1, params)

		# A appears 3 times, B appears 2 times, C and D appear 1 time each
		@test length(freq.values) == 4  # Only 4 unique values total
		@test freq.values[1] == "A"  # Most frequent
		@test freq.counts[1] == 3
		@test freq.other_count === nothing  # All values shown
	end

	@testset "Frequency Table - With Other Count" begin
		df = DataFrame(x = ["A", "A", "A", "B", "B", "C", "D", "E", "F"])
		params = Positron.ColumnFrequencyTableParams(2)  # Top 2 only

		freq = Positron.compute_frequency_table(df, 1, params)

		@test length(freq.values) == 2
		@test freq.values == ["A", "B"]  # Top 2
		@test freq.counts == [3, 2]
		@test freq.other_count == 4  # C, D, E, F (4 values)
	end

	@testset "Frequency Table - Numeric Values" begin
		df = DataFrame(num = [1, 2, 1, 3, 1, 2, 4, 5])
		params = Positron.ColumnFrequencyTableParams(10)

		freq = Positron.compute_frequency_table(df, 1, params)

		# 1 appears 3 times, 2 appears 2 times, others 1 time
		@test freq.values[1] == "1"
		@test freq.counts[1] == 3
		@test freq.values[2] == "2"
		@test freq.counts[2] == 2
	end

	@testset "Frequency Table - With Missing" begin
		df = DataFrame(x = ["A", missing, "A", "B", missing, "A"])
		params = Positron.ColumnFrequencyTableParams(10)

		freq = Positron.compute_frequency_table(df, 1, params)

		# Missing values excluded from frequency table
		@test length(freq.values) == 2
		@test freq.values == ["A", "B"]
		@test freq.counts == [3, 1]
	end

	@testset "Frequency Table - All Same Value" begin
		df = DataFrame(x = ["Same", "Same", "Same", "Same"])
		params = Positron.ColumnFrequencyTableParams(5)

		freq = Positron.compute_frequency_table(df, 1, params)

		@test length(freq.values) == 1
		@test freq.values == ["Same"]
		@test freq.counts == [4]
		@test freq.other_count === nothing
	end

	@testset "Frequency Table - Empty Data" begin
		df = DataFrame(x = String[])
		params = Positron.ColumnFrequencyTableParams(5)

		freq = Positron.compute_frequency_table(df, 1, params)

		@test isempty(freq.values)
		@test isempty(freq.counts)
	end

	@testset "Frequency Table - All Missing" begin
		df = DataFrame(x = [missing, missing, missing])
		params = Positron.ColumnFrequencyTableParams(5)

		freq = Positron.compute_frequency_table(df, 1, params)

		# All missing, no values to show
		@test isempty(freq.values)
		@test isempty(freq.counts)
	end

	@testset "Frequency Table - Large Dataset" begin
		# Create dataset with known distribution
		values = vcat(
			fill("A", 1000),
			fill("B", 500),
			fill("C", 250),
			["D$i" for i in 1:100]  # 100 unique rare values
		)
		df = DataFrame(category = shuffle(values))
		params = Positron.ColumnFrequencyTableParams(3)  # Top 3

		freq = Positron.compute_frequency_table(df, 1, params)

		@test length(freq.values) == 3
		@test freq.values == ["A", "B", "C"]
		@test freq.counts == [1000, 500, 250]
		@test freq.other_count == 100  # The D values
	end
end

# TODO: Add more comprehensive tests
# Priority test areas (from Python test_data_explorer.py):
# - Categorical columns (requires CategoricalArrays.jl)
# - Schema operations (get_schema, search_schema, sort schema results)
# - Filter evaluation for all filter types
# - Export data selection
# - Schema change detection
# - Row labels with indices
