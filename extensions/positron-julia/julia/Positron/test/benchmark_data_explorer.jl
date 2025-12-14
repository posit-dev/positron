# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Performance benchmarks for Data Explorer operations.

Compare Julia performance with Python implementation to ensure we're in the
same ballpark. These are not unit tests but performance validation.

Run with:
    julia --project=. test/benchmark_data_explorer.jl
"""

using DataFrames
using Statistics
using Printf
using Random

# Add parent to load path
push!(LOAD_PATH, joinpath(@__DIR__, ".."))
using Positron

println("=" ^ 70)
println("Data Explorer Performance Benchmarks")
println("=" ^ 70)

# Benchmark 1: Large DataFrame Histogram (1M rows)
println("\n📊 Benchmark 1: Histogram on 1M rows")
println("-" ^ 70)

df_1m = DataFrame(value = randn(1_000_000))
params = Positron.ColumnHistogramParams(
	Positron.ColumnHistogramParamsMethod_Sturges,
	100,
	nothing
)

print("Julia:  ")
julia_time = @elapsed begin
	hist = Positron.compute_histogram(df_1m, 1, params)
end
println(@sprintf("%.3f seconds", julia_time))
println("  Bins: $(length(hist.bin_counts))")
println("  Total count: $(sum(hist.bin_counts))")

println("\n💡 Expected Python time: ~0.05-0.15 seconds")
if julia_time < 0.5
	println("✅ Performance: GOOD (comparable to Python)")
else
	println("⚠️  Performance: SLOW (may need optimization)")
end

# Benchmark 2: Summary Statistics (1M rows)
println("\n📊 Benchmark 2: Summary Statistics on 1M rows")
println("-" ^ 70)

values = randn(1_000_000)
print("Julia:  ")
julia_time = @elapsed begin
	stats = Positron.compute_number_stats(values)
end
println(@sprintf("%.3f seconds", julia_time))
println("  Mean: $(stats.mean)")
println("  Stdev: $(stats.stdev)")

println("\n💡 Expected Python time: ~0.01-0.05 seconds")
if julia_time < 0.2
	println("✅ Performance: GOOD")
else
	println("⚠️  Performance: SLOW")
end

# Benchmark 3: Sorting (1M rows)
println("\n📊 Benchmark 3: Sorting 1M rows")
println("-" ^ 70)

df_sort = DataFrame(x = shuffle(1:1_000_000))
instance = Positron.DataExplorerInstance(df_sort, "bench")
instance.sort_keys = [Positron.ColumnSortKey(0, true)]

print("Julia:  ")
julia_time = @elapsed begin
	Positron.apply_sorting!(instance)
end
println(@sprintf("%.3f seconds", julia_time))
println("  Sorted indices: $(length(instance.sorted_indices))")

println("\n💡 Expected Python time: ~0.1-0.3 seconds")
if julia_time < 1.0
	println("✅ Performance: GOOD")
else
	println("⚠️  Performance: SLOW")
end

# Benchmark 4: Filter + Sort + get_data_values (realistic workflow)
println("\n📊 Benchmark 4: Filter + Sort + Get Data (100K rows)")
println("-" ^ 70)

df_workflow = DataFrame(
	id = 1:100_000,
	value = rand(100_000),
	category = rand(["A", "B", "C", "D"], 100_000)
)

instance = Positron.DataExplorerInstance(df_workflow, "workflow")

# Simulate filter (keep 50% of rows)
instance.filtered_indices = [i for i = 1:100_000 if i % 2 == 0]

# Sort
instance.sort_keys = [Positron.ColumnSortKey(1, false)]  # Sort by value desc

print("Julia:  ")
julia_time = @elapsed begin
	Positron.apply_sorting!(instance)
	Positron.update_view_indices!(instance)

	# Get first 1000 rows of view
	col = Positron.get_column_vector(df_workflow, 2)
	if instance.view_indices !== nothing
		view_slice = instance.view_indices[1:min(1000, length(instance.view_indices))]
		values = col[view_slice]
	end
end
println(@sprintf("%.3f seconds", julia_time))
println("  View rows: $(length(instance.view_indices))")

println("\n💡 Expected Python time: ~0.05-0.15 seconds")
if julia_time < 0.5
	println("✅ Performance: GOOD")
else
	println("⚠️  Performance: SLOW")
end

# Benchmark 5: Wide DataFrame (1000 columns)
println("\n📊 Benchmark 5: Operations on Wide DataFrame (1K cols x 10K rows)")
println("-" ^ 70)

wide_df = DataFrame([Symbol("col$i") => rand(10_000) for i in 1:1_000])

print("Column access:  ")
col_time = @elapsed begin
	for i in 1:100
		col = Positron.get_column_vector(wide_df, i)
	end
end
println(@sprintf("%.3f seconds (100 columns)", col_time))

println("\n💡 Expected: < 0.1 seconds")
if col_time < 0.2
	println("✅ Performance: GOOD")
else
	println("⚠️  Performance: SLOW")
end

# Summary
println("\n" * "=" ^ 70)
println("SUMMARY")
println("=" ^ 70)
println("All benchmarks completed. Compare times with Python implementation.")
println("If any benchmark shows as SLOW, consider DataFrame-specific optimizations.")
println("\nNote: First run includes compilation time. Run again for JIT-compiled performance.")
