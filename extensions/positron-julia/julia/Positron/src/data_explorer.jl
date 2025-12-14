# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Data Explorer service for Positron.

This module provides the Data Explorer functionality, allowing users to
explore tabular data (DataFrames, matrices, etc.) in a spreadsheet-like view.
"""

"""
Represents a single data explorer instance for a table.

Maintains virtual views through index arrays (never modifies original data):
- filtered_indices: Rows passing all row filters
- sorted_indices: All rows in sorted order
- view_indices: Combined filtered + sorted view (final view shown to user)
"""
mutable struct DataExplorerInstance
	comm::Any  # PositronComm or test mock
	data::Any  # The actual data (DataFrame, Matrix, etc.) - NEVER MODIFIED
	display_name::String

	# Filters and sorting configuration
	column_filters::Vector{ColumnFilter}
	row_filters::Vector{RowFilter}
	sort_keys::Vector{ColumnSortKey}

	# Virtual view indices (the core of efficient filtering/sorting)
	filtered_indices::Union{Vector{Int},Nothing}  # Rows passing filters
	sorted_indices::Union{Vector{Int},Nothing}    # Rows in sort order
	view_indices::Union{Vector{Int},Nothing}      # Combined filter+sort view

	# Schema caching
	schema_cache::Union{Vector{ColumnSchema},Nothing}
	inferred_types::Dict{Int,Type}  # Column index -> inferred type

	function DataExplorerInstance(data::Any, display_name::String)
		new(
			nothing,
			data,
			display_name,
			ColumnFilter[],
			RowFilter[],
			ColumnSortKey[],
			nothing,  # filtered_indices
			nothing,  # sorted_indices
			nothing,  # view_indices
			nothing,  # schema_cache
			Dict{Int,Type}()  # inferred_types
		)
	end
end

"""
Initialize a data explorer instance with a comm.
"""
function init!(instance::DataExplorerInstance, comm::PositronComm)
	instance.comm = comm

	on_msg!(comm, msg -> handle_data_explorer_msg(instance, msg))
	on_close!(comm, () -> handle_data_explorer_close(instance))
end

"""
Update view_indices by combining filtered_indices and sorted_indices.

This is the CORE of the Data Explorer performance pattern (matches Python/R):
1. No filters, no sorts → view_indices = nothing (use full data)
2. Only filters → view_indices = filtered_indices
3. Only sorts → view_indices = sorted_indices
4. Both → view_indices = sorted_indices filtered by filtered_indices

This function is called after any filter or sort operation.
"""
function update_view_indices!(instance::DataExplorerInstance)
	# Case 1: No filtering or sorting
	if isnothing(instance.filtered_indices) && isnothing(instance.sorted_indices)
		instance.view_indices = nothing
		return
	end

	# Case 2: Only filtering
	if isnothing(instance.sorted_indices)
		instance.view_indices = instance.filtered_indices
		return
	end

	# Case 3: Only sorting
	if isnothing(instance.filtered_indices)
		instance.view_indices = instance.sorted_indices
		return
	end

	# Case 4: Both filtering and sorting
	# sorted_indices contains ALL rows in sort order
	# filtered_indices contains subset passing filters (in ascending order)
	# Result: sorted indices that also pass filters
	# Use binary search since filtered_indices is sorted
	filtered_set = Set(instance.filtered_indices)
	instance.view_indices = filter(
		idx -> idx in filtered_set,
		instance.sorted_indices
	)
end

"""
Handle incoming messages on the data explorer comm.
"""
function handle_data_explorer_msg(instance::DataExplorerInstance, msg::Dict)
	method = get(msg, "method", nothing)
	request = parse_data_explorer_request(msg)

	if method == "get_state"
		handle_get_state(instance)
	elseif request isa DataExplorerGetSchemaParams
		handle_get_schema(instance, request)
	elseif request isa DataExplorerSearchSchemaParams
		handle_search_schema(instance, request)
	elseif request isa DataExplorerGetDataValuesParams
		handle_get_data_values(instance, request)
	elseif request isa DataExplorerGetRowLabelsParams
		handle_get_row_labels(instance, request)
	elseif request isa DataExplorerSetColumnFiltersParams
		handle_set_column_filters(instance, request)
	elseif request isa DataExplorerSetRowFiltersParams
		handle_set_row_filters(instance, request)
	elseif request isa DataExplorerSetSortColumnsParams
		handle_set_sort_columns(instance, request)
	elseif request isa DataExplorerGetColumnProfilesParams
		handle_get_column_profiles(instance, request)
	elseif request isa DataExplorerExportDataSelectionParams
		handle_export_data_selection(instance, request)
	end
end

"""
Handle data explorer comm close.
"""
function handle_data_explorer_close(instance::DataExplorerInstance)
	instance.comm = nothing
end

"""
Handle get_state request.
"""
function handle_get_state(instance::DataExplorerInstance)
	nrows, ncols = get_shape(instance.data)

	# Get filtered shape
	filtered_rows = instance.filtered_row_indices !== nothing ?
					length(instance.filtered_row_indices) : nrows
	filtered_cols = instance.filtered_column_indices !== nothing ?
					length(instance.filtered_column_indices) : ncols

	state = BackendState(
		instance.display_name,
		TableShape(filtered_rows, filtered_cols),
		TableShape(nrows, ncols),
		has_row_labels(instance.data),
		instance.column_filters,
		instance.row_filters,
		instance.sort_keys,
		get_supported_features()
	)

	send_result(instance.comm, state)
end

"""
Handle get_schema request.
"""
function handle_get_schema(instance::DataExplorerInstance, request::DataExplorerGetSchemaParams)
	columns = ColumnSchema[]

	for idx in request.column_indices
		# Adjust for 0-based indexing from frontend
		julia_idx = idx + 1
		if julia_idx < 1 || julia_idx > get_num_columns(instance.data)
			continue
		end

		schema = get_column_schema(instance.data, julia_idx)
		push!(columns, schema)
	end

	result = TableSchema(columns)
	send_result(instance.comm, result)
end

"""
Handle search_schema request.
"""
function handle_search_schema(instance::DataExplorerInstance, request::DataExplorerSearchSchemaParams)
	# Get all column indices
	ncols = get_num_columns(instance.data)
	matches = Int[]

	for col_idx in 1:ncols
		schema = get_column_schema(instance.data, col_idx)

		# Check if column matches all filters
		if matches_column_filters(schema, request.filters)
			# Convert to 0-based index for frontend
			push!(matches, col_idx - 1)
		end
	end

	# Apply sorting if requested
	if request.sort_order !== nothing && request.sort_order != "original"
		sort_column_matches!(matches, instance.data, request.sort_order)
	end

	result = SearchSchemaResult(matches)
	send_result(instance.comm, result)
end

"""
Handle get_data_values request.

CRITICAL PERFORMANCE FUNCTION: Uses view_indices to efficiently retrieve data
after filtering/sorting without modifying the original data.

Follows the Python/R pattern:
1. Frontend requests rows 0-99 of the VIEW
2. Backend maps view[0:100] → view_indices[0:100] → original data indices
3. Fetches from original data using fancy indexing

This keeps get_data_values performant even with complex filters/sorts.
"""
function handle_get_data_values(instance::DataExplorerInstance, request::DataExplorerGetDataValuesParams)
	columns = Vector{Vector{Any}}()

	for col_sel in request.columns
		# Adjust for 0-based indexing
		julia_col_idx = col_sel.column_index + 1

		# Get the column vector (full column from original data)
		col = get_column_vector(instance.data, julia_col_idx)

		# Apply virtual view indexing based on spec
		if col_sel.spec isa DataSelectionRange
			# Get indices from the view
			first_idx = col_sel.spec.first_index + 1  # Convert to 1-based
			last_idx = col_sel.spec.last_index + 1

			if instance.view_indices !== nothing
				# Map view indices to original data indices
				view_slice = instance.view_indices[first_idx:min(last_idx, length(instance.view_indices))]
				values = col[view_slice]
			else
				# No view, direct slicing
				values = col[first_idx:min(last_idx, length(col))]
			end

		elseif col_sel.spec isa DataSelectionIndices
			# Specific indices from the view
			indices = [i + 1 for i in col_sel.spec.indices]  # Convert to 1-based

			if instance.view_indices !== nothing
				# Map view indices to original data indices
				original_indices = instance.view_indices[indices]
				values = col[original_indices]
			else
				# No view, direct indexing
				values = col[indices]
			end
		else
			# All cells - apply view if exists
			if instance.view_indices !== nothing
				values = col[instance.view_indices]
			else
				values = col
			end
		end

		# Format the values
		formatted = [format_value(v, request.format_options) for v in values]
		push!(columns, formatted)
	end

	result = TableData(columns)
	send_result(instance.comm, result)
end

"""
Handle get_row_labels request.
"""
function handle_get_row_labels(instance::DataExplorerInstance, request::DataExplorerGetRowLabelsParams)
	labels = get_row_label_values(instance.data, request.selection, request.format_options)
	result = TableRowLabels(labels)
	send_result(instance.comm, result)
end

"""
Handle set_column_filters request.
"""
function handle_set_column_filters(instance::DataExplorerInstance, request::DataExplorerSetColumnFiltersParams)
	instance.column_filters = request.filters
	# Invalidate cached indices
	instance.filtered_column_indices = nothing
	send_result(instance.comm, nothing)
end

"""
Handle set_row_filters request.

Applies row filters and updates virtual view indices following the Python/R pattern.
"""
function handle_set_row_filters(instance::DataExplorerInstance, request::DataExplorerSetRowFiltersParams)
	instance.row_filters = request.filters

	# Apply filters to get filtered_indices
	instance.filtered_indices = apply_row_filters(instance.data, request.filters)

	# Update combined view_indices (filter + sort)
	update_view_indices!(instance)

	# Report how many rows pass the filters
	selected_num_rows = instance.filtered_indices !== nothing ?
						length(instance.filtered_indices) :
						get_num_rows(instance.data)

	result = FilterResult(selected_num_rows, nothing)
	send_result(instance.comm, result)
end

"""
Handle set_sort_columns request.

Applies sorting and updates virtual view indices following the Python/R pattern.
"""
function handle_set_sort_columns(instance::DataExplorerInstance, request::DataExplorerSetSortColumnsParams)
	instance.sort_keys = request.sort_keys

	# Compute sorted_indices for all rows
	if !isempty(request.sort_keys)
		apply_sorting!(instance)
	else
		instance.sorted_indices = nothing
	end

	# Update combined view_indices (filter + sort)
	update_view_indices!(instance)

	send_result(instance.comm, nothing)
end

"""
Handle get_column_profiles request.
"""
function handle_get_column_profiles(instance::DataExplorerInstance, request::DataExplorerGetColumnProfilesParams)
	# Process profiles asynchronously and send results via events
	# For now, we'll process synchronously
	for profile_request in request.profiles
		# Adjust for 0-based indexing
		julia_col_idx = profile_request.column_index + 1

		for spec in profile_request.profiles
			result = compute_column_profile(instance.data, julia_col_idx, spec, request.format_options)

			# Send result event
			event = DataUpdateEvent(
				request.callback_id,
				profile_request.column_index,  # Keep 0-based for frontend
				result
			)
			send_event(instance.comm, "column_profile_result", event)
		end
	end

	send_result(instance.comm, nothing)
end

"""
Handle export_data_selection request.
"""
function handle_export_data_selection(instance::DataExplorerInstance, request::DataExplorerExportDataSelectionParams)
	data_str = export_selection(instance.data, request.selection, request.format)
	result = ExportedData(data_str, request.format)
	send_result(instance.comm, result)
end

# -------------------------------------------------------------------------
# Data Access Functions (to be specialized for different table types)
# -------------------------------------------------------------------------

"""
Get the shape (nrows, ncols) of the data.
"""
function get_shape(data::Any)::Tuple{Int, Int}
	if data isa AbstractMatrix
		return size(data)
	elseif data isa AbstractVector
		return (length(data), 1)
	else
		# Try Tables.jl interface
		try
			if isdefined(Main, :Tables) && Main.Tables.istable(data)
				rows = Main.Tables.rows(data)
				cols = Main.Tables.columnnames(data)
				return (length(collect(rows)), length(cols))
			end
		catch
		end
		return (0, 0)
	end
end

"""
Get number of rows.
"""
function get_num_rows(data::Any)::Int
	nrows, _ = get_shape(data)
	return nrows
end

"""
Get number of columns.
"""
function get_num_columns(data::Any)::Int
	_, ncols = get_shape(data)
	return ncols
end

"""
Check if data has row labels.
"""
function has_row_labels(data::Any)::Bool
	# DataFrames don't have row labels by default
	# Check for specific types that do
	type_name = string(typeof(data))
	return occursin("NamedArray", type_name) || occursin("AxisArray", type_name)
end

"""
Get column schema for a specific column.
"""
function get_column_schema(data::Any, col_idx::Int)::ColumnSchema
	col_name = get_column_name(data, col_idx)
	col_type = get_column_type(data, col_idx)
	display_type = julia_type_to_display_type(col_type)

	ColumnSchema(
		col_name,
		col_idx - 1,  # 0-based for frontend
		string(col_type),
		display_type,
		nothing,  # column_label
		nothing,  # description
		nothing,  # children
		nothing,  # precision
		nothing,  # scale
		nothing,  # timezone
		nothing   # type_size
	)
end

"""
Get column name.
"""
function get_column_name(data::Any, col_idx::Int)::String
	if data isa AbstractMatrix
		return "Column $col_idx"
	elseif data isa AbstractVector
		return "Value"
	else
		# Try Tables.jl interface
		try
			if isdefined(Main, :Tables) && Main.Tables.istable(data)
				cols = Main.Tables.columnnames(data)
				return string(cols[col_idx])
			end
		catch
		end
		return "Column $col_idx"
	end
end

"""
Get column element type.
"""
function get_column_type(data::Any, col_idx::Int)::Type
	if data isa AbstractMatrix
		return eltype(data)
	elseif data isa AbstractVector
		return eltype(data)
	else
		# Try Tables.jl interface
		try
			if isdefined(Main, :Tables) && Main.Tables.istable(data)
				cols = Main.Tables.columns(data)
				col = cols[col_idx]
				return eltype(col)
			end
		catch
		end
		return Any
	end
end

"""
Convert Julia type to display type.
"""
function julia_type_to_display_type(T::Type)::ColumnDisplayType
	if T <: Bool
		return ColumnDisplayType_Boolean
	elseif T <: AbstractString
		return ColumnDisplayType_String
	elseif T <: Integer
		return ColumnDisplayType_Number
	elseif T <: AbstractFloat
		return ColumnDisplayType_Number
	elseif T <: Dates.Date
		return ColumnDisplayType_Date
	elseif T <: Dates.DateTime
		return ColumnDisplayType_Datetime
	elseif T <: Dates.Time
		return ColumnDisplayType_Time
	elseif T <: AbstractArray
		return ColumnDisplayType_Array
	elseif T <: AbstractDict
		return ColumnDisplayType_Object
	else
		return ColumnDisplayType_Unknown
	end
end

"""
Get column values for a selection.
"""
function get_column_values(data::Any, col_idx::Int, spec::Any, format_opts::FormatOptions)::Vector{Any}
	# Get row indices from spec
	if spec isa DataSelectionRange
		row_indices = (spec.first_index + 1):(spec.last_index + 1)  # Convert to 1-based
	elseif spec isa DataSelectionIndices
		row_indices = [i + 1 for i in spec.indices]  # Convert to 1-based
	else
		row_indices = 1:get_num_rows(data)
	end

	values = Any[]
	for row_idx in row_indices
		val = get_cell_value(data, row_idx, col_idx)
		formatted = format_value(val, format_opts)
		push!(values, formatted)
	end

	return values
end

"""
Get a single cell value.
"""
function get_cell_value(data::Any, row_idx::Int, col_idx::Int)::Any
	if data isa AbstractMatrix
		return data[row_idx, col_idx]
	elseif data isa AbstractVector
		return data[row_idx]
	else
		# Try Tables.jl interface
		try
			if isdefined(Main, :Tables) && Main.Tables.istable(data)
				cols = Main.Tables.columns(data)
				col = cols[col_idx]
				return col[row_idx]
			end
		catch
		end
		return nothing
	end
end

"""
Get an entire column as a vector for efficient operations.

Used for sorting, filtering, and statistics. Returns a vector that can be
used with Julia's vectorized operations.
"""
function get_column_vector(data::Any, col_idx::Int)::Vector
	if data isa AbstractMatrix
		return data[:, col_idx]
	elseif data isa AbstractVector
		return data
	else
		# Try Tables.jl interface (DataFrames, etc.)
		try
			if isdefined(Main, :Tables) && Main.Tables.istable(data)
				cols = Main.Tables.columns(data)
				col = cols[col_idx]
				return collect(col)  # Ensure it's a vector
			elseif isdefined(Main, :DataFrames) && data isa Main.DataFrames.DataFrame
				return data[!, col_idx]  # Get column without copying
			end
		catch e
			@debug "Failed to get column vector" col_idx exception=e
		end
	end

	# Fallback: iterate and collect
	nrows = get_num_rows(data)
	return [get_cell_value(data, i, col_idx) for i in 1:nrows]
end

"""
Format a value according to format options.
"""
function format_value(val::Any, format_opts::FormatOptions)::Any
	if val === nothing || val === missing
		return 0  # Special value code for null/missing
	end

	# Format the value as a string
	str = string(val)

	# Truncate if too long
	if length(str) > format_opts.max_value_length
		str = str[1:format_opts.max_value_length] * "..."
	end

	return str
end

"""
Get row label values.
"""
function get_row_label_values(data::Any, selection::Any, format_opts::FormatOptions)::Vector{Vector{String}}
	# Most data doesn't have row labels
	# Return ordinal indices as labels
	if selection isa DataSelectionRange
		row_indices = (selection.first_index + 1):(selection.last_index + 1)
	elseif selection isa DataSelectionIndices
		row_indices = [i + 1 for i in selection.indices]
	else
		row_indices = 1:get_num_rows(data)
	end

	labels = [string(i) for i in row_indices]
	return [labels]  # Single column of labels
end

"""
Check if a column schema matches the given filters.
"""
function matches_column_filters(schema::ColumnSchema, filters::Vector{ColumnFilter})::Bool
	if isempty(filters)
		return true
	end

	for filter in filters
		if !matches_single_filter(schema, filter)
			return false
		end
	end

	return true
end

"""
Check if a column matches a single filter.
"""
function matches_single_filter(schema::ColumnSchema, filter::ColumnFilter)::Bool
	if filter.filter_type == ColumnFilterType_TextSearch && filter.params isa FilterTextSearch
		term = lowercase(filter.params.term)
		name = lowercase(schema.column_name)

		search_type = filter.params.search_type
		if search_type == TextSearchType_Contains
			return occursin(term, name)
		elseif search_type == TextSearchType_StartsWith
			return startswith(name, term)
		elseif search_type == TextSearchType_EndsWith
			return endswith(name, term)
		elseif search_type == TextSearchType_NotContains
			return !occursin(term, name)
		else
			return true
		end
	elseif filter.filter_type == ColumnFilterType_MatchDataTypes && filter.params isa FilterMatchDataTypes
		return schema.type_display in filter.params.display_types
	end

	return true
end

"""
Sort column match indices.
"""
function sort_column_matches!(matches::Vector{Int}, data::Any, sort_order::String)
	if sort_order == "ascending_name"
		sort!(matches, by=idx -> lowercase(get_column_name(data, idx + 1)))
	elseif sort_order == "descending_name"
		sort!(matches, by=idx -> lowercase(get_column_name(data, idx + 1)), rev=true)
	elseif sort_order == "ascending_type"
		sort!(matches, by=idx -> string(get_column_type(data, idx + 1)))
	elseif sort_order == "descending_type"
		sort!(matches, by=idx -> string(get_column_type(data, idx + 1)), rev=true)
	end
end

"""
Apply row filters to data.
"""
function apply_row_filters(data::Any, filters::Vector{RowFilter})::Union{Vector{Int}, Nothing}
	if isempty(filters)
		return nothing
	end

	nrows = get_num_rows(data)
	mask = trues(nrows)

	for filter in filters
		filter_mask = apply_single_row_filter(data, filter)
		if filter.condition == "and"
			mask .&= filter_mask
		else  # "or"
			mask .|= filter_mask
		end
	end

	return findall(mask)
end

"""
Apply a single row filter.
"""
function apply_single_row_filter(data::Any, filter::RowFilter)::BitVector
	nrows = get_num_rows(data)
	col_idx = filter.column_schema.column_index + 1  # Convert to 1-based

	mask = falses(nrows)

	for row_idx in 1:nrows
		val = get_cell_value(data, row_idx, col_idx)
		mask[row_idx] = value_matches_filter(val, filter)
	end

	return mask
end

"""
Check if a value matches a row filter.
"""
function value_matches_filter(val::Any, filter::RowFilter)::Bool
	filter_type = filter.filter_type

	if filter_type == RowFilterType_IsNull
		return val === nothing || val === missing
	elseif filter_type == RowFilterType_NotNull
		return val !== nothing && val !== missing
	elseif filter_type == RowFilterType_IsEmpty
		return val === nothing || val === missing || (val isa AbstractString && isempty(val))
	elseif filter_type == RowFilterType_NotEmpty
		return val !== nothing && val !== missing && !(val isa AbstractString && isempty(val))
	elseif filter_type == RowFilterType_IsTrue
		return val === true
	elseif filter_type == RowFilterType_IsFalse
		return val === false
	end

	# Handle comparison filters
	if filter.params === nothing
		return true
	end

	if filter.params isa FilterComparison
		return apply_comparison(val, filter.params.op, filter.params.value)
	elseif filter.params isa FilterBetween
		return apply_between(val, filter.params.left_value, filter.params.right_value,
							 filter_type == RowFilterType_NotBetween)
	elseif filter.params isa FilterTextSearch
		return apply_text_search(val, filter.params)
	elseif filter.params isa FilterSetMembership
		return apply_set_membership(val, filter.params)
	end

	return true
end

"""
Apply comparison filter.
"""
function apply_comparison(val::Any, op::String, compare_val::String)::Bool
	if val === nothing || val === missing
		return false
	end

	# Try to convert compare_val to same type as val
	try
		if val isa Number
			compare = parse(typeof(val), compare_val)
		else
			compare = compare_val
		end

		if op == "="
			return val == compare
		elseif op == "!="
			return val != compare
		elseif op == "<"
			return val < compare
		elseif op == "<="
			return val <= compare
		elseif op == ">"
			return val > compare
		elseif op == ">="
			return val >= compare
		end
	catch
		return false
	end

	return false
end

"""
Apply between filter.
"""
function apply_between(val::Any, left::String, right::String, negate::Bool)::Bool
	if val === nothing || val === missing
		return false
	end

	try
		if val isa Number
			left_val = parse(typeof(val), left)
			right_val = parse(typeof(val), right)
		else
			left_val = left
			right_val = right
		end

		result = left_val <= val <= right_val
		return negate ? !result : result
	catch
		return false
	end
end

"""
Apply text search filter.
"""
function apply_text_search(val::Any, params::FilterTextSearch)::Bool
	if val === nothing || val === missing
		return false
	end

	str = string(val)
	term = params.term

	if !params.case_sensitive
		str = lowercase(str)
		term = lowercase(term)
	end

	if params.search_type == TextSearchType_Contains
		return occursin(term, str)
	elseif params.search_type == TextSearchType_NotContains
		return !occursin(term, str)
	elseif params.search_type == TextSearchType_StartsWith
		return startswith(str, term)
	elseif params.search_type == TextSearchType_EndsWith
		return endswith(str, term)
	elseif params.search_type == TextSearchType_RegexMatch
		try
			flags = params.case_sensitive ? "" : "i"
			rx = Regex(term, flags)
			return occursin(rx, str)
		catch
			return false
		end
	end

	return false
end

"""
Apply set membership filter.
"""
function apply_set_membership(val::Any, params::FilterSetMembership)::Bool
	if val === nothing || val === missing
		return !params.inclusive
	end

	str_val = string(val)
	in_set = str_val in params.values

	return params.inclusive ? in_set : !in_set
end

"""
Compute sorted_indices for ALL rows based on sort_keys.

Critical: Sorts ALL rows, not just filtered ones. This is combined with
filtered_indices in update_view_indices! for the final view.

Matches Python's _sort_data and R's r_sort_rows pattern.
"""
function apply_sorting!(instance::DataExplorerInstance)
	if isempty(instance.sort_keys)
		instance.sorted_indices = nothing
		return
	end

	nrows = get_num_rows(instance.data)

	# Build list of columns to sort by
	sort_cols = []
	sort_orders = []
	for key in instance.sort_keys
		col_idx = key.column_index + 1  # Convert to 1-based
		push!(sort_cols, get_column_vector(instance.data, col_idx))
		push!(sort_orders, !key.ascending)  # Julia's rev flag (true = descending)
	end

	# Use Julia's sortperm with multi-column sorting (lexicographic)
	# This is equivalent to Python's lexsort_indexer and R's order()
	if length(sort_cols) == 1
		instance.sorted_indices = sortperm(sort_cols[1], rev=sort_orders[1], alg=MergeSort)
	else
		# Multi-column sort: create tuple of values for each row
		instance.sorted_indices = sortperm(
			collect(zip(sort_cols...)),
			rev=sort_orders[1],  # Primary sort order
			alg=MergeSort  # Stable sort
		)
	end
end

"""
Compute a column profile.
"""
function compute_column_profile(data::Any, col_idx::Int, spec::ColumnProfileSpec, format_opts::FormatOptions)::ColumnProfileResult
	profile_type = spec.profile_type

	null_count = nothing
	summary_stats = nothing
	small_histogram = nothing
	large_histogram = nothing
	small_freq_table = nothing
	large_freq_table = nothing

	if profile_type == ColumnProfileType_NullCount
		null_count = count_nulls(data, col_idx)
	elseif profile_type == ColumnProfileType_SummaryStats
		summary_stats = compute_summary_stats(data, col_idx)
	elseif profile_type in (ColumnProfileType_SmallHistogram, ColumnProfileType_LargeHistogram)
		if spec.params isa ColumnHistogramParams
			hist = compute_histogram(data, col_idx, spec.params)
			if profile_type == ColumnProfileType_SmallHistogram
				small_histogram = hist
			else
				large_histogram = hist
			end
		end
	elseif profile_type in (ColumnProfileType_SmallFrequencyTable, ColumnProfileType_LargeFrequencyTable)
		if spec.params isa ColumnFrequencyTableParams
			freq = compute_frequency_table(data, col_idx, spec.params)
			if profile_type == ColumnProfileType_SmallFrequencyTable
				small_freq_table = freq
			else
				large_freq_table = freq
			end
		end
	end

	ColumnProfileResult(null_count, summary_stats, small_histogram, large_histogram, small_freq_table, large_freq_table)
end

"""
Count null values in a column.
"""
function count_nulls(data::Any, col_idx::Int)::Int
	nrows = get_num_rows(data)
	count = 0

	for row_idx in 1:nrows
		val = get_cell_value(data, row_idx, col_idx)
		if val === nothing || val === missing
			count += 1
		end
	end

	return count
end

"""
Compute summary statistics for a column.
"""
function compute_summary_stats(data::Any, col_idx::Int)::ColumnSummaryStats
	nrows = get_num_rows(data)
	col_type = get_column_type(data, col_idx)
	display_type = julia_type_to_display_type(col_type)

	number_stats = nothing
	string_stats = nothing
	boolean_stats = nothing
	date_stats = nothing
	datetime_stats = nothing
	other_stats = nothing

	# Collect non-null values
	values = Any[]
	for row_idx in 1:nrows
		val = get_cell_value(data, row_idx, col_idx)
		if val !== nothing && val !== missing
			push!(values, val)
		end
	end

	if isempty(values)
		return ColumnSummaryStats(display_type, nothing, nothing, nothing, nothing, nothing, nothing)
	end

	if display_type in (ColumnDisplayType_Number, ColumnDisplayType_Number)
		number_stats = compute_number_stats(values)
	elseif display_type == ColumnDisplayType_String
		string_stats = compute_string_stats(values)
	elseif display_type == ColumnDisplayType_Boolean
		boolean_stats = compute_boolean_stats(values)
	else
		other_stats = SummaryStatsOther(length(unique(values)))
	end

	ColumnSummaryStats(display_type, number_stats, string_stats, boolean_stats, date_stats, datetime_stats, other_stats)
end

"""
Compute numeric statistics.
"""
function compute_number_stats(values::Vector)::SummaryStatsNumber
	if isempty(values)
		return SummaryStatsNumber(nothing, nothing, nothing, nothing, nothing)
	end

	nums = filter(x -> x isa Number, values)
	if isempty(nums)
		return SummaryStatsNumber(nothing, nothing, nothing, nothing, nothing)
	end

	SummaryStatsNumber(
		string(minimum(nums)),
		string(maximum(nums)),
		string(sum(nums) / length(nums)),
		string(sort(nums)[div(length(nums), 2) + 1]),  # Simple median
		string(std(nums))
	)
end

"""
Compute string statistics.
"""
function compute_string_stats(values::Vector)::SummaryStatsString
	strs = filter(x -> x isa AbstractString, values)
	num_empty = count(isempty, strs)
	num_unique = length(unique(strs))
	SummaryStatsString(num_empty, num_unique)
end

"""
Compute boolean statistics.
"""
function compute_boolean_stats(values::Vector)::SummaryStatsBoolean
	bools = filter(x -> x isa Bool, values)
	true_count = count(identity, bools)
	false_count = length(bools) - true_count
	SummaryStatsBoolean(true_count, false_count)
end

"""
Compute histogram for a column.
"""
function compute_histogram(data::Any, col_idx::Int, params::ColumnHistogramParams)::ColumnHistogram
	nrows = get_num_rows(data)

	# Collect numeric values
	values = Float64[]
	for row_idx in 1:nrows
		val = get_cell_value(data, row_idx, col_idx)
		if val isa Number
			push!(values, Float64(val))
		end
	end

	if isempty(values)
		return ColumnHistogram(String[], Int[], ColumnQuantileValue[])
	end

	# Compute bin edges
	min_val, max_val = extrema(values)
	num_bins = params.num_bins

	if min_val == max_val
		# All same value
		return ColumnHistogram([string(min_val), string(min_val)], [length(values)], ColumnQuantileValue[])
	end

	bin_width = (max_val - min_val) / num_bins
	bin_edges = [min_val + i * bin_width for i in 0:num_bins]
	bin_counts = zeros(Int, num_bins)

	for val in values
		bin_idx = min(num_bins, max(1, ceil(Int, (val - min_val) / bin_width)))
		bin_counts[bin_idx] += 1
	end

	# Compute quantiles if requested
	quantiles = ColumnQuantileValue[]
	if params.quantiles !== nothing
		sorted_values = sort(values)
		for q in params.quantiles
			idx = max(1, ceil(Int, q * length(sorted_values)))
			push!(quantiles, ColumnQuantileValue(q, string(sorted_values[idx]), true))
		end
	end

	ColumnHistogram(string.(bin_edges), bin_counts, quantiles)
end

"""
Compute frequency table for a column.
"""
function compute_frequency_table(data::Any, col_idx::Int, params::ColumnFrequencyTableParams)::ColumnFrequencyTable
	nrows = get_num_rows(data)

	# Count occurrences
	counts = Dict{Any, Int}()
	null_count = 0

	for row_idx in 1:nrows
		val = get_cell_value(data, row_idx, col_idx)
		if val === nothing || val === missing
			null_count += 1
		else
			counts[val] = get(counts, val, 0) + 1
		end
	end

	# Get top K
	sorted_pairs = sort(collect(counts), by=x -> -x[2])
	top_k = sorted_pairs[1:min(params.limit, length(sorted_pairs))]

	values = [string(p[1]) for p in top_k]
	freq_counts = [p[2] for p in top_k]
	other_count = sum(p[2] for p in sorted_pairs[min(params.limit + 1, end):end]; init=0)

	ColumnFrequencyTable(values, freq_counts, other_count > 0 ? other_count : nothing)
end

"""
Export data selection.
"""
function export_selection(data::Any, selection::TableSelection, format::ExportFormat)::String
	# Get selected data
	# For now, export all data
	nrows, ncols = get_shape(data)

	io = IOBuffer()

	separator = format == ExportFormat_Csv ? "," : "\t"

	# Header
	for col_idx in 1:ncols
		if col_idx > 1
			write(io, separator)
		end
		write(io, get_column_name(data, col_idx))
	end
	write(io, "\n")

	# Data
	for row_idx in 1:min(nrows, 10000)  # Limit export size
		for col_idx in 1:ncols
			if col_idx > 1
				write(io, separator)
			end
			val = get_cell_value(data, row_idx, col_idx)
			write(io, string(val === nothing || val === missing ? "" : val))
		end
		write(io, "\n")
	end

	return String(take!(io))
end

"""
Get supported features for the data explorer.
"""
function get_supported_features()::SupportedFeatures
	SupportedFeatures(
		SearchSchemaFeatures(
			SupportStatus_Supported,
			[
				ColumnFilterTypeSupportStatus(ColumnFilterType_TextSearch, SupportStatus_Supported),
				ColumnFilterTypeSupportStatus(ColumnFilterType_MatchDataTypes, SupportStatus_Supported)
			]
		),
		SetColumnFiltersFeatures(
			SupportStatus_Supported,
			[
				ColumnFilterTypeSupportStatus(ColumnFilterType_TextSearch, SupportStatus_Supported),
				ColumnFilterTypeSupportStatus(ColumnFilterType_MatchDataTypes, SupportStatus_Supported)
			]
		),
		SetRowFiltersFeatures(
			SupportStatus_Supported,
			SupportStatus_Supported,
			[
				RowFilterTypeSupportStatus(RowFilterType_IsNull, SupportStatus_Supported),
				RowFilterTypeSupportStatus(RowFilterType_NotNull, SupportStatus_Supported),
				RowFilterTypeSupportStatus(RowFilterType_Compare, SupportStatus_Supported),
				RowFilterTypeSupportStatus(RowFilterType_Between, SupportStatus_Supported),
				RowFilterTypeSupportStatus(RowFilterType_Search, SupportStatus_Supported)
			]
		),
		GetColumnProfilesFeatures(
			SupportStatus_Supported,
			[
				ColumnProfileTypeSupportStatus(ColumnProfileType_NullCount, SupportStatus_Supported),
				ColumnProfileTypeSupportStatus(ColumnProfileType_SummaryStats, SupportStatus_Supported),
				ColumnProfileTypeSupportStatus(ColumnProfileType_SmallHistogram, SupportStatus_Supported),
				ColumnProfileTypeSupportStatus(ColumnProfileType_SmallFrequencyTable, SupportStatus_Supported)
			]
		),
		SetSortColumnsFeatures(SupportStatus_Supported),
		ExportDataSelectionFeatures(
			SupportStatus_Supported,
			[ExportFormat_Csv, ExportFormat_Tsv]
		),
		ConvertToCodeFeatures(SupportStatus_Unsupported, nothing)
	)
end

# -------------------------------------------------------------------------
# Data Explorer Manager
# -------------------------------------------------------------------------

"""
Manages all data explorer instances.
"""
mutable struct DataExplorerService
	instances::Dict{String, DataExplorerInstance}

	function DataExplorerService()
		new(Dict{String, DataExplorerInstance}())
	end
end

"""
Create a new data explorer for a value.
"""
function open_data_explorer!(service::DataExplorerService, data::Any, name::String; id::String=string(uuid4()))
	instance = DataExplorerInstance(data, name)
	service.instances[id] = instance
	return instance
end

"""
Close a data explorer instance.
"""
function close_data_explorer!(service::DataExplorerService, id::String)
	if haskey(service.instances, id)
		instance = service.instances[id]
		if instance.comm !== nothing
			close!(instance.comm)
		end
		delete!(service.instances, id)
	end
end

# Import std function if available
function std(values::Vector)
	n = length(values)
	if n <= 1
		return 0.0
	end
	m = sum(values) / n
	return sqrt(sum((v - m)^2 for v in values) / (n - 1))
end
