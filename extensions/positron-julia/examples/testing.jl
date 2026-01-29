# Testing file for Positron Julia features
#
# Required packages:
#   using Pkg
#   Pkg.add(["DataFrames", "Plots"])
#
# Optional packages for Parquet support:
#   Pkg.add("Parquet2")  # or Pkg.add("Arrow")

using Dates
using LinearAlgebra
using DataFrames
using Random: shuffle

# =============================================================================
# Primitive Types
# =============================================================================

# Booleans
bool_true = true
bool_false = false

# Integers
int_small = 42
int_negative = -123
int_zero = 0
int_large = 1_000_000_000

# Different integer sizes
int8_val = Int8(127)
int32_val = Int32(2147483647)
uint8_val = UInt8(255)

# Floats
float_pi = 3.14159
float_negative = -2.71828
float_zero = 0.0
float_inf = Inf
float_nan = NaN
float32_val = Float32(1.5)

# Complex numbers
complex_simple = 1 + 2im
complex_float = 3.14 + 2.71im

# Strings
string_hello = "Hello, World!"
string_empty = ""
string_unicode = "Hello 🌍 🚀 ✨"
string_multiline = """
This is a
multiline
string
"""
string_long = "a"^100  # Long string for truncation testing

# Symbols
symbol_simple = :my_symbol
symbol_with_underscore = :my_var_name

# Nothing and Missing
nothing_val = nothing
missing_val = missing

# =============================================================================
# Collections
# =============================================================================

# Arrays/Vectors
array_empty = Int[]
array_small = [1, 2, 3]
array_large = collect(1:100)
array_very_large = zeros(10_000)  # Tests truncation
array_strings = ["apple", "banana", "cherry"]
array_mixed = [1, "two", 3.0]  # Mixed types (Vector{Any})

# Matrices
matrix_small = [1 2 3; 4 5 6]
matrix_large = zeros(50, 50)
matrix_rand = rand(10, 10)
matrix_identity = Matrix{Float64}(I, 3, 3)

# Ranges
range_simple = 1:10
range_step = 1:2:20
range_float = 0.0:0.1:1.0

# Tuples
tuple_simple = (1, 2, 3)
tuple_mixed = (42, "hello", 3.14)
tuple_named = (x = 10, y = 20, z = 30)
tuple_nested = (a = (1, 2), b = (3, 4))

# Sets
set_numbers = Set([1, 2, 3, 4, 5])
set_strings = Set(["red", "green", "blue"])
set_empty = Set{Int}()

# Dictionaries
dict_empty = Dict{String,Int}()
dict_simple = Dict("a" => 1, "b" => 2, "c" => 3)
dict_string_vals = Dict("name" => "Alice", "age" => "30", "city" => "NYC")
dict_symbol_keys = Dict(:x => 100, :y => 200, :z => 300)
dict_int_keys = Dict(1 => "one", 2 => "two", 3 => "three")
dict_nested = Dict(
	"level1" => Dict(
		"level2" => Dict(
			"level3" => [1, 2, 3]
		)
	)
)

# =============================================================================
# Composite Types (Structs)
# =============================================================================

struct Point
	x::Float64
	y::Float64
end

struct Person
	name::String
	age::Int
	email::String
end

mutable struct Counter
	count::Int
	label::String
end

struct Rectangle
	top_left::Point
	bottom_right::Point
	color::String
end

# Create struct instances
point1 = Point(3.0, 4.0)
point2 = Point(10.0, 20.0)

person1 = Person("Alice", 30, "alice@example.com")
person2 = Person("Bob", 25, "bob@example.com")

counter1 = Counter(0, "Main Counter")
counter2 = Counter(100, "Secondary")

rect1 = Rectangle(Point(0.0, 10.0), Point(10.0, 0.0), "blue")

# Array of structs
people = [
	Person("Alice", 30, "alice@example.com"),
	Person("Bob", 25, "bob@example.com"),
	Person("Charlie", 35, "charlie@example.com"),
	Person("Diana", 28, "diana@example.com"),
	Person("Eve", 32, "eve@example.com"),
]

points_array = [Point(Float64(i), Float64(i^2)) for i in 1:20]

# =============================================================================
# Functions
# =============================================================================

# Built-in functions
func_sin = sin
func_sqrt = sqrt
func_println = println

# Anonymous function
func_square = x -> x^2
func_add = (x, y) -> x + y

# Named function
function my_function(x, y)
	return x + y
end

function recursive_factorial(n)
	n <= 1 ? 1 : n * recursive_factorial(n - 1)
end

# =============================================================================
# Types and Modules
# =============================================================================

# Type references
type_int = Int64
type_string = String
type_vector = Vector{Float64}
type_dict = Dict{Symbol,Any}

# =============================================================================
# DateTime
# =============================================================================

datetime_now = DateTime(2024, 12, 13, 10, 30, 0)
datetime_unix_epoch = DateTime(1970, 1, 1)

date_today = Date(2024, 12, 13)
date_future = Date(2025, 1, 1)

time_now = Time(10, 30, 45)
time_midnight = Time(0, 0, 0)

# =============================================================================
# DataFrames
# =============================================================================

using DataFrames

df_simple = DataFrame(
	id = 1:5,
	name = ["Alice", "Bob", "Charlie", "Diana", "Eve"],
	age = [30, 25, 35, 28, 32],
	salary = [75000.0, 68000.0, 85000.0, 72000.0, 78000.0]
)

df_large = DataFrame(
	id = 1:1000,
	value = rand(1000),
	category = rand(["A", "B", "C", "D"], 1000),
	timestamp = [DateTime(2024, 1, 1) + Day(i) for i = 1:1000]
)

df_empty = DataFrame()

df_with_missing = DataFrame(
	x = [1, 2, missing, 4, 5],
	y = [missing, "b", "c", "d", missing],
	z = [1.1, 2.2, 3.3, missing, 5.5]
)

df_mixed_types = DataFrame(
	int_col = [1, 2, 3],
	float_col = [1.1, 2.2, 3.3],
	string_col = ["a", "b", "c"],
	bool_col = [true, false, true],
	date_col = [Date(2024, 1, 1), Date(2024, 1, 2), Date(2024, 1, 3)]
)

df_single_row = DataFrame(a = [1], b = ["one"])

df_single_col = DataFrame(values = 1:10)

df_wide = DataFrame([Symbol("col$i") => rand(5) for i in 1:50])

# =============================================================================
# Nested and Complex Structures
# =============================================================================

# Nested dict with arrays
complex_nested = Dict(
	"users" => [
		Dict("name" => "Alice", "scores" => [85, 92, 78]),
		Dict("name" => "Bob", "scores" => [90, 88, 95]),
	],
	"metadata" => Dict(
		"created" => "2024-12-13",
		"version" => 1,
		"tags" => ["test", "example"]
	)
)

# Array of dicts
array_of_dicts = [
	Dict("id" => i, "value" => i^2, "label" => "item_$i")
	for i = 1:10
]

# Dict of arrays
dict_of_arrays = Dict(
	"integers" => [1, 2, 3, 4, 5],
	"floats" => [1.1, 2.2, 3.3],
	"strings" => ["a", "b", "c"],
	"bools" => [true, false, true]
)

# Dict of structs
dict_of_people = Dict(
	"alice" => Person("Alice", 30, "alice@example.com"),
	"bob" => Person("Bob", 25, "bob@example.com")
)

# =============================================================================
# Edge Cases and Special Values
# =============================================================================

# Very long string for truncation testing
very_long_string = "x"^5000

# Very large array for performance testing
very_large_array = collect(1:100_000)

# Deeply nested structure
deeply_nested = Dict(
	"l1" => Dict(
		"l2" => Dict(
			"l3" => Dict(
				"l4" => Dict(
					"l5" => "deep value"
				)
			)
		)
	)
)

# =============================================================================
# PLOTTING TESTS
# =============================================================================

using Plots

# Basic line plot
plot_line = plot(1:10, (1:10) .^ 2, title = "Line Plot", xlabel = "x", ylabel = "y")
display(plot_line)

# Scatter plot
plot_scatter = scatter(rand(50), rand(50), title = "Scatter Plot", markersize = 5)
display(plot_scatter)

# Multiple series
x = 0:0.1:2π
plot_multi = plot(x, [sin.(x) cos.(x)], label = ["sin" "cos"], title = "Trig Functions")
display(plot_multi)

# Histogram
plot_hist = histogram(randn(1000), bins = 30, title = "Normal Distribution", alpha = 0.7)
display(plot_hist)

# Bar plot
plot_bar = bar(["A", "B", "C", "D"], [4, 7, 2, 9], title = "Bar Chart")
display(plot_bar)

# Heatmap
plot_heatmap = heatmap(rand(10, 10), title = "Heatmap")
display(plot_heatmap)

# Subplots
p1 = plot(1:10, rand(10), title = "Plot 1")
p2 = scatter(1:10, rand(10), title = "Plot 2")
p3 = bar(1:5, rand(5), title = "Plot 3")
p4 = histogram(randn(100), title = "Plot 4")
plot_subplots = plot(p1, p2, p3, p4, layout = (2, 2), size = (800, 600))
display(plot_subplots)

# 3D surface plot
x3d = range(-2, 2, length = 50)
y3d = range(-2, 2, length = 50)
z3d = [sin(sqrt(xi^2 + yi^2)) for xi in x3d, yi in y3d]
plot_3d = surface(x3d, y3d, z3d, title = "3D Surface")
display(plot_3d)

# =============================================================================
# DATA EXPLORER TESTS
# =============================================================================

using DataFrames

# Small DataFrame for basic testing
de_small = DataFrame(
	id = 1:5,
	name = ["Alice", "Bob", "Charlie", "Diana", "Eve"],
	score = [85.5, 92.0, 78.5, 88.0, 95.5]
)

# Medium DataFrame for scrolling/pagination
de_medium = DataFrame(
	row_id = 1:100,
	value = rand(100),
	category = rand(["X", "Y", "Z"], 100),
	flag = rand(Bool, 100)
)

# Large DataFrame for performance testing
de_large = DataFrame(
	id = 1:10_000,
	x = rand(10_000),
	y = rand(10_000),
	z = rand(10_000),
	group = rand('A':'Z', 10_000),
	timestamp = [DateTime(2024, 1, 1) + Second(i) for i = 1:10_000]
)

# Wide DataFrame (many columns)
de_wide = DataFrame([Symbol("col_$i") => rand(20) for i in 1:100])

# DataFrame with many data types
de_types = DataFrame(
	int8_col = Int8[1, 2, 3, 4, 5],
	int64_col = Int64[100, 200, 300, 400, 500],
	float32_col = Float32[1.1, 2.2, 3.3, 4.4, 5.5],
	float64_col = Float64[1.111, 2.222, 3.333, 4.444, 5.555],
	bool_col = [true, false, true, false, true],
	string_col = ["apple", "banana", "cherry", "date", "elderberry"],
	char_col = ['A', 'B', 'C', 'D', 'E'],
	date_col = [Date(2024, 1, i) for i = 1:5],
	datetime_col = [DateTime(2024, 1, 1, i, 0, 0) for i = 1:5],
	symbol_col = [:a, :b, :c, :d, :e]
)

# DataFrame with missing values
de_missing = DataFrame(
	a = [1, missing, 3, missing, 5],
	b = [missing, "x", missing, "y", missing],
	c = [1.0, 2.0, missing, 4.0, missing],
	d = [true, missing, false, missing, true]
)

# DataFrame with special string content
de_strings = DataFrame(
	normal = ["hello", "world", "test", "data", "frame"],
	with_spaces = ["hello world", "  leading", "trailing  ", "  both  ", ""],
	unicode = ["café", "日本語", "emoji 🎉", "math ∑∫∂", "arrows →←↑↓"],
	special = ["tab\there", "new\nline", "quote\"here", "backslash\\here", "null\0char"],
	long_text = ["short", "a"^50, "b"^100, "c"^200, "d"^500]
)

# DataFrame with numeric edge cases
de_numeric = DataFrame(
	normal = [1.0, 2.0, 3.0, 4.0, 5.0],
	very_small = [1e-10, 1e-20, 1e-100, 1e-200, 1e-308],
	very_large = [1e10, 1e20, 1e100, 1e200, 1e308],
	special = [0.0, -0.0, Inf, -Inf, NaN],
	precise = [1/3, π, ℯ, sqrt(2), (1 + sqrt(5)) / 2]
)

# DataFrame for filter testing
de_filter = DataFrame(
	name = repeat(["Alice", "Bob", "Charlie", "Diana"], 25),
	department = repeat(["Engineering", "Sales", "Marketing", "HR"], inner = 25),
	salary = rand(50000:100000, 100),
	years = rand(1:20, 100),
	active = rand(Bool, 100)
)

# DataFrame for sort testing
de_sort = DataFrame(
	alpha = shuffle(collect('A':'Z')),
	numeric = shuffle(1:26),
	mixed_case = shuffle(vcat(string.('A':'M'), string.('a':'m'))),
	with_nulls = shuffle(vcat(1:20, fill(missing, 6)))
)

# Nested/complex column types
de_complex = DataFrame(
	arrays = [[1, 2], [3, 4, 5], [6], Int[], [7, 8, 9, 10]],
	tuples = [(1, "a"), (2, "b"), (3, "c"), (4, "d"), (5, "e")],
	dicts = [Dict("x" => i) for i = 1:5]
)

# Matrix as table (Data Explorer should handle matrices too)
de_matrix = rand(50, 10)

# =============================================================================
# PARQUET/FLIGHTS DATA (Optional)
# =============================================================================

# Try to load flights.parquet for realistic data explorer testing
flights_path = joinpath(@__DIR__, "..", "..", "positron-duckdb", "src", "test", "data", "flights.parquet")

if isfile(flights_path)
    try
        if Base.find_package("Parquet2") !== nothing
            using Parquet2
            flights = DataFrame(Parquet2.Dataset(flights_path))
            println("  flights: $(nrow(flights)) rows x $(ncol(flights)) columns (loaded with Parquet2)")
        elseif Base.find_package("Arrow") !== nothing
            using Arrow
            flights = DataFrame(Arrow.Table(flights_path))
            println("  flights: $(nrow(flights)) rows x $(ncol(flights)) columns (loaded with Arrow)")
        else
            println("  flights: Parquet2 or Arrow not installed. Run: Pkg.add(\"Parquet2\")")
        end
    catch e
        println("  flights: Error loading parquet file: $e")
    end
else
    println("  flights: Parquet file not found at expected path")
end

println("\n✅ All test variables created!")
println("\nTo test Data Explorer: Click on any 'de_*' variable in the Variables pane")
println("To test Plots: The plots should have appeared in the Plots pane")
if @isdefined(flights)
    println("To test with real data: Use the 'flights' DataFrame (NYC flights dataset)")
end
