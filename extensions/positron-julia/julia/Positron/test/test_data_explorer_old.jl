# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

using Test

function test_data_explorer()
	@testset "ColumnDisplayType enum" begin
		@test string(Positron.CDT_Boolean) == "boolean"
		@test string(Positron.CDT_String) == "string"
		@test string(Positron.CDT_Integer) == "integer"
		@test string(Positron.CDT_Floating) == "floating"

		# Round-trip
		@test Positron.STRING_TO_COLUMN_DISPLAY_TYPE["boolean"] == Positron.CDT_Boolean
		@test Positron.STRING_TO_COLUMN_DISPLAY_TYPE["integer"] == Positron.CDT_Integer
	end

	@testset "Get shape - Matrix" begin
		m = [1 2 3; 4 5 6]
		nrows, ncols = Positron.get_shape(m)
		@test nrows == 2
		@test ncols == 3
	end

	@testset "Get shape - Vector" begin
		v = [1, 2, 3, 4, 5]
		nrows, ncols = Positron.get_shape(v)
		@test nrows == 5
		@test ncols == 1
	end

	@testset "Julia type to display type" begin
		@test Positron.julia_type_to_display_type(Bool) == Positron.CDT_Boolean
		@test Positron.julia_type_to_display_type(Int64) == Positron.CDT_Integer
		@test Positron.julia_type_to_display_type(Float64) == Positron.CDT_Floating
		@test Positron.julia_type_to_display_type(String) == Positron.CDT_String
	end

	@testset "Get column schema - Matrix" begin
		m = [1.0 2.0; 3.0 4.0]
		schema = Positron.get_column_schema(m, 1)

		@test schema.column_name == "Column 1"
		@test schema.column_index == 0  # 0-based for frontend
		@test schema.type_display == Positron.CDT_Floating
	end

	@testset "Get cell value - Matrix" begin
		m = [1 2 3; 4 5 6]
		@test Positron.get_cell_value(m, 1, 1) == 1
		@test Positron.get_cell_value(m, 1, 2) == 2
		@test Positron.get_cell_value(m, 2, 1) == 4
	end

	@testset "Get cell value - Vector" begin
		v = [10, 20, 30]
		@test Positron.get_cell_value(v, 1, 1) == 10
		@test Positron.get_cell_value(v, 2, 1) == 20
	end

	@testset "Format value" begin
		opts = Positron.FormatOptions(2, 4, 7, 1000, nothing)

		@test Positron.format_value(42, opts) == "42"
		@test Positron.format_value("hello", opts) == "hello"
		@test Positron.format_value(nothing, opts) == 0  # Special value code
		@test Positron.format_value(missing, opts) == 0
	end

	@testset "Apply comparison filter" begin
		@test Positron.apply_comparison(5, "=", "5") == true
		@test Positron.apply_comparison(5, "=", "6") == false
		@test Positron.apply_comparison(5, "<", "10") == true
		@test Positron.apply_comparison(5, ">", "3") == true
		@test Positron.apply_comparison(5, "<=", "5") == true
		@test Positron.apply_comparison(5, ">=", "5") == true
		@test Positron.apply_comparison(5, "!=", "6") == true

		# String comparison
		@test Positron.apply_comparison("abc", "=", "abc") == true
		@test Positron.apply_comparison("abc", "<", "def") == true

		# Null handling
		@test Positron.apply_comparison(nothing, "=", "5") == false
		@test Positron.apply_comparison(missing, "=", "5") == false
	end

	@testset "Apply between filter" begin
		@test Positron.apply_between(5, "1", "10", false) == true
		@test Positron.apply_between(0, "1", "10", false) == false
		@test Positron.apply_between(5, "1", "10", true) == false  # negated
		@test Positron.apply_between(0, "1", "10", true) == true   # negated
	end

	@testset "Apply text search filter" begin
		params_contains = Positron.FilterTextSearch(Positron.TST_Contains, "ello", false)
		@test Positron.apply_text_search("hello", params_contains) == true
		@test Positron.apply_text_search("world", params_contains) == false

		params_starts = Positron.FilterTextSearch(Positron.TST_StartsWith, "hel", false)
		@test Positron.apply_text_search("hello", params_starts) == true
		@test Positron.apply_text_search("world", params_starts) == false

		params_ends = Positron.FilterTextSearch(Positron.TST_EndsWith, "llo", false)
		@test Positron.apply_text_search("hello", params_ends) == true
		@test Positron.apply_text_search("world", params_ends) == false

		# Case sensitivity
		params_case = Positron.FilterTextSearch(Positron.TST_Contains, "HELLO", true)
		@test Positron.apply_text_search("hello", params_case) == false
		@test Positron.apply_text_search("HELLO", params_case) == true

		params_nocase = Positron.FilterTextSearch(Positron.TST_Contains, "HELLO", false)
		@test Positron.apply_text_search("hello", params_nocase) == true
	end

	@testset "Apply set membership filter" begin
		params_in = Positron.FilterSetMembership(["a", "b", "c"], true)
		@test Positron.apply_set_membership("a", params_in) == true
		@test Positron.apply_set_membership("d", params_in) == false

		params_not_in = Positron.FilterSetMembership(["a", "b", "c"], false)
		@test Positron.apply_set_membership("a", params_not_in) == false
		@test Positron.apply_set_membership("d", params_not_in) == true
	end

	@testset "Count nulls" begin
		# Create a simple test case using vectors
		data = [1, nothing, 3, missing, 5]
		# For vector, we treat it as single column
		nrows, _ = Positron.get_shape(data)
		@test nrows == 5

		count = 0
		for i in 1:nrows
			val = data[i]
			if val === nothing || val === missing
				count += 1
			end
		end
		@test count == 2
	end

	@testset "Compute number stats" begin
		values = [1.0, 2.0, 3.0, 4.0, 5.0]
		stats = Positron.compute_number_stats(values)

		@test stats.min_value == "1.0"
		@test stats.max_value == "5.0"
		@test stats.mean == "3.0"
	end

	@testset "Compute string stats" begin
		values = ["hello", "world", "", "test"]
		stats = Positron.compute_string_stats(values)

		@test stats.num_empty == 1
		@test stats.num_unique == 4
	end

	@testset "Compute boolean stats" begin
		values = [true, true, false, true, false]
		stats = Positron.compute_boolean_stats(values)

		@test stats.true_count == 3
		@test stats.false_count == 2
	end

	@testset "Request parsing" begin
		# Test get_state request
		state_data = Dict("method" => "get_state", "params" => Dict())
		req = Positron.parse_data_explorer_request(state_data)
		@test req isa Positron.GetStateRequest

		# Test get_schema request
		schema_data = Dict("method" => "get_schema", "params" => Dict("column_indices" => [0, 1, 2]))
		req = Positron.parse_data_explorer_request(schema_data)
		@test req isa Positron.GetSchemaRequest
		@test req.column_indices == [0, 1, 2]

		# Test set_sort_columns request
		sort_data = Dict("method" => "set_sort_columns", "params" => Dict("sort_keys" => []))
		req = Positron.parse_data_explorer_request(sort_data)
		@test req isa Positron.SetSortColumnsRequest
	end

	@testset "Export format enum" begin
		@test string(Positron.EF_Csv) == "csv"
		@test string(Positron.EF_Tsv) == "tsv"
		@test string(Positron.EF_Html) == "html"
	end

	@testset "Support status enum" begin
		@test string(Positron.SS_Supported) == "supported"
		@test string(Positron.SS_Unsupported) == "unsupported"
	end

	@testset "Supported features" begin
		features = Positron.get_supported_features()

		@test features.search_schema.support_status == Positron.SS_Supported
		@test features.set_column_filters.support_status == Positron.SS_Supported
		@test features.set_row_filters.support_status == Positron.SS_Supported
		@test features.set_sort_columns.support_status == Positron.SS_Supported
		@test features.export_data_selection.support_status == Positron.SS_Supported
	end
end
