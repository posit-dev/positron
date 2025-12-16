# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Comprehensive tests for inspecting different Julia data types.

This module tests variable inspection, kind detection, display formatting,
and child enumeration for all major Julia types.
"""

using Test
using Dates
using DataFrames

@testset "Type Inspectors" begin
    @testset "Inspect Boolean" begin
        @test Positron.get_variable_kind(true) == Positron.VariableKind_Boolean
        @test Positron.get_variable_kind(false) == Positron.VariableKind_Boolean

        @test Positron.get_display_value(true) == "true"
        @test Positron.get_display_value(false) == "false"

        @test Positron.get_display_type(true) == "Bool"
        @test Positron.get_display_type(false) == "Bool"

        @test Positron.value_has_children(true) == false
        @test Positron.value_has_children(false) == false
    end

    @testset "Inspect String" begin
        # Basic strings
        @test Positron.get_variable_kind("hello") == Positron.VariableKind_String
        @test Positron.get_variable_kind("") == Positron.VariableKind_String

        @test Positron.get_display_value("hello") == "\"hello\""
        @test Positron.get_display_value("") == "\"\""

        @test Positron.get_display_type("hello") == "String"

        @test Positron.get_variable_length("hello") == 5
        @test Positron.get_variable_length("") == 0

        @test Positron.value_has_children("hello") == false

        # Unicode strings
        @test Positron.get_display_value("hello 🌍") == "\"hello 🌍\""
        @test Positron.get_variable_kind("hello 🌍") == Positron.VariableKind_String

        # Multiline strings
        multiline = "line1\nline2\nline3"
        @test Positron.get_variable_kind(multiline) == Positron.VariableKind_String
        @test occursin("line1", Positron.get_display_value(multiline))
    end

    @testset "Inspect Integer" begin
        # Different integer types
        @test Positron.get_variable_kind(42) == Positron.VariableKind_Number
        @test Positron.get_variable_kind(Int8(1)) == Positron.VariableKind_Number
        @test Positron.get_variable_kind(Int32(1)) == Positron.VariableKind_Number
        @test Positron.get_variable_kind(Int64(1)) == Positron.VariableKind_Number
        @test Positron.get_variable_kind(UInt8(1)) == Positron.VariableKind_Number
        @test Positron.get_variable_kind(UInt32(1)) == Positron.VariableKind_Number
        @test Positron.get_variable_kind(UInt64(1)) == Positron.VariableKind_Number

        @test Positron.get_display_value(42) == "42"
        @test Positron.get_display_value(-123) == "-123"
        @test Positron.get_display_value(0) == "0"

        @test Positron.get_display_type(42) == "Int64"
        @test Positron.get_display_type(Int32(1)) == "Int32"

        @test Positron.value_has_children(42) == false
    end

    @testset "Inspect Float" begin
        @test Positron.get_variable_kind(3.14) == Positron.VariableKind_Number
        @test Positron.get_variable_kind(Float32(3.14)) == Positron.VariableKind_Number
        @test Positron.get_variable_kind(Float64(3.14)) == Positron.VariableKind_Number

        @test Positron.get_display_value(3.14) == "3.14"
        @test Positron.get_display_value(-2.5) == "-2.5"
        @test Positron.get_display_value(0.0) == "0.0"

        # Special values
        @test occursin("Inf", Positron.get_display_value(Inf))
        @test occursin("NaN", Positron.get_display_value(NaN))

        @test Positron.get_display_type(3.14) == "Float64"
        @test Positron.get_display_type(Float32(3.14)) == "Float32"

        @test Positron.value_has_children(3.14) == false
    end

    @testset "Inspect Complex" begin
        @test Positron.get_variable_kind(1 + 2im) == Positron.VariableKind_Number
        @test Positron.get_variable_kind(3.14 + 2.71im) == Positron.VariableKind_Number

        # Julia displays complex numbers without spaces
        @test occursin("1+2im", Positron.get_display_value(1 + 2im))
        @test occursin("Complex", Positron.get_display_type(1 + 2im))

        @test Positron.value_has_children(1 + 2im) == false
    end

    @testset "Inspect Nothing and Missing" begin
        @test Positron.get_variable_kind(nothing) == Positron.VariableKind_Empty
        @test Positron.get_variable_kind(missing) == Positron.VariableKind_Empty

        @test Positron.get_display_value(nothing) == "nothing"
        @test Positron.get_display_value(missing) == "missing"

        @test Positron.value_has_children(nothing) == false
        @test Positron.value_has_children(missing) == false
    end

    @testset "Inspect Type/Class" begin
        @test Positron.get_variable_kind(Int) == Positron.VariableKind_Class
        @test Positron.get_variable_kind(Float64) == Positron.VariableKind_Class
        @test Positron.get_variable_kind(String) == Positron.VariableKind_Class
        @test Positron.get_variable_kind(Vector{Int}) == Positron.VariableKind_Class

        @test occursin("Int", Positron.get_display_value(Int))
        @test occursin("Float64", Positron.get_display_value(Float64))
    end

    @testset "Inspect Vector/Array" begin
        # Empty array
        empty_arr = Int[]
        @test Positron.get_variable_kind(empty_arr) == Positron.VariableKind_Collection
        @test Positron.get_variable_length(empty_arr) == 0
        @test Positron.value_has_children(empty_arr) == false

        # Small array
        small_arr = [1, 2, 3]
        @test Positron.get_variable_kind(small_arr) == Positron.VariableKind_Collection
        @test Positron.get_variable_length(small_arr) == 3
        @test Positron.value_has_children(small_arr) == true
        @test Positron.get_display_value(small_arr) == "[1, 2, 3]"
        @test occursin("Vector{Int", Positron.get_display_type(small_arr))

        # Get children
        children = Positron.get_children(small_arr)
        @test length(children) == 3
        @test children[1].display_name == "[1]"
        @test children[1].display_value == "1"

        # Large array (tests truncation)
        large_arr = collect(1:200)
        @test Positron.get_variable_kind(large_arr) == Positron.VariableKind_Collection
        @test Positron.get_variable_length(large_arr) == 200
        children = Positron.get_children(large_arr)
        @test length(children) == 100  # Should be truncated

        # Different element types
        float_arr = [1.1, 2.2, 3.3]
        @test Positron.get_variable_kind(float_arr) == Positron.VariableKind_Collection
        @test occursin("Float64", Positron.get_display_type(float_arr))

        string_arr = ["a", "b", "c"]
        @test Positron.get_variable_kind(string_arr) == Positron.VariableKind_Collection
        @test occursin("String", Positron.get_display_type(string_arr))
    end

    @testset "Inspect Matrix" begin
        mat = [1 2; 3 4]
        @test Positron.get_variable_kind(mat) == Positron.VariableKind_Collection
        @test occursin("Matrix", Positron.get_display_type(mat))
        @test Positron.value_has_viewer(mat) == true  # Matrices can be viewed

        # Get size - length returns first dimension (like Python's shape[0])
        @test size(mat) == (2, 2)
        @test Positron.get_variable_length(mat) == 2  # 2 rows (first dimension)

        # Larger matrix
        large_mat = zeros(100, 50)
        @test Positron.get_variable_kind(large_mat) == Positron.VariableKind_Collection
        @test Positron.value_has_viewer(large_mat) == true
        @test Positron.get_variable_length(large_mat) == 100  # 100 rows
    end

    @testset "Inspect Range" begin
        r = 1:10
        @test Positron.get_variable_kind(r) == Positron.VariableKind_Collection
        @test Positron.get_variable_length(r) == 10
        @test Positron.value_has_children(r) == true

        # Get children
        children = Positron.get_children(r)
        @test length(children) == 10
        @test children[1].display_value == "1"
        @test children[10].display_value == "10"

        # Step range
        r2 = 1:2:10
        @test Positron.get_variable_kind(r2) == Positron.VariableKind_Collection
        @test Positron.get_variable_length(r2) == 5
    end

    @testset "Inspect Tuple" begin
        t = (1, 2, 3)
        # Tuples are currently classified as Other (could be Collection in future)
        @test Positron.get_variable_kind(t) == Positron.VariableKind_Other
        @test Positron.get_variable_length(t) == 3
        @test Positron.value_has_children(t) == true

        # Named tuple
        nt = (a = 1, b = 2, c = 3)
        @test Positron.get_variable_kind(nt) == Positron.VariableKind_Other
        @test Positron.get_variable_length(nt) == 3
        @test Positron.value_has_children(nt) == true

        # Children should show fields
        children = Positron.get_children(nt)
        @test length(children) == 3
        names = [c.display_name for c in children]
        @test "a" in names
        @test "b" in names
        @test "c" in names
    end

    @testset "Inspect Set" begin
        s = Set([1, 2, 3])
        # Sets are currently classified as Other (could be Collection in future)
        @test Positron.get_variable_kind(s) == Positron.VariableKind_Other
        @test Positron.get_variable_length(s) == 3
        # Sets have fieldcount > 0 in Julia so they're treated as having children
        @test Positron.value_has_children(s) == true

        # Empty set
        empty_set = Set{Int}()
        @test Positron.get_variable_kind(empty_set) == Positron.VariableKind_Other
        @test Positron.get_variable_length(empty_set) == 0
        # Empty set still has fields, so has_children is true
        @test Positron.value_has_children(empty_set) == true
    end

    @testset "Inspect Dict" begin
        # Empty dict
        empty_dict = Dict{String,Int}()
        @test Positron.get_variable_kind(empty_dict) == Positron.VariableKind_Map
        @test Positron.get_variable_length(empty_dict) == 0
        @test Positron.value_has_children(empty_dict) == false

        # Small dict
        d = Dict("a" => 1, "b" => 2, "c" => 3)
        @test Positron.get_variable_kind(d) == Positron.VariableKind_Map
        @test Positron.get_variable_length(d) == 3
        @test Positron.value_has_children(d) == true
        @test Positron.get_display_type(d) == "Dict"

        # Get children
        children = Positron.get_children(d)
        @test length(children) == 3
        names = [c.display_name for c in children]
        @test "a" in names || "b" in names || "c" in names

        # Different key/value types
        int_dict = Dict(1 => "one", 2 => "two")
        @test Positron.get_variable_kind(int_dict) == Positron.VariableKind_Map
        @test Positron.get_variable_length(int_dict) == 2

        symbol_dict = Dict(:a => 1, :b => 2)
        @test Positron.get_variable_kind(symbol_dict) == Positron.VariableKind_Map
    end

    @testset "Inspect Function" begin
        @test Positron.get_variable_kind(sin) == Positron.VariableKind_Function
        @test Positron.get_variable_kind(cos) == Positron.VariableKind_Function
        @test Positron.get_variable_kind(sqrt) == Positron.VariableKind_Function

        # Anonymous function
        f = x -> x^2
        @test Positron.get_variable_kind(f) == Positron.VariableKind_Function

        # Functions don't have children
        @test Positron.value_has_children(sin) == false
    end

    @testset "Inspect Struct" begin
        struct Point2D
            x::Float64
            y::Float64
        end

        pt = Point2D(3.0, 4.0)
        @test Positron.get_variable_kind(pt) == Positron.VariableKind_Other
        @test Positron.value_has_children(pt) == true

        # Get children (fields)
        children = Positron.get_children(pt)
        @test length(children) == 2
        names = [c.display_name for c in children]
        @test "x" in names
        @test "y" in names

        # Find x field
        x_child = filter(c -> c.display_name == "x", children)[1]
        @test x_child.display_value == "3.0"

        # Nested struct
        struct Rectangle
            top_left::Point2D
            bottom_right::Point2D
        end

        rect = Rectangle(Point2D(0.0, 10.0), Point2D(10.0, 0.0))
        @test Positron.value_has_children(rect) == true

        rect_children = Positron.get_children(rect)
        @test length(rect_children) == 2
    end

    @testset "Inspect Mutable Struct" begin
        mutable struct Counter
            count::Int
        end

        c = Counter(5)
        @test Positron.get_variable_kind(c) == Positron.VariableKind_Other
        @test Positron.value_has_children(c) == true

        children = Positron.get_children(c)
        @test length(children) == 1
        @test children[1].display_name == "count"
        @test children[1].display_value == "5"
    end

    @testset "Inspect DateTime" begin
        dt = DateTime(2024, 1, 1, 12, 30, 45)
        # DateTime is a struct with fields
        @test Positron.value_has_children(dt) == true
        @test occursin("2024", Positron.get_display_value(dt))
    end

    @testset "Inspect Symbols" begin
        sym = :my_symbol
        # Symbols are like strings but represented differently
        @test Positron.get_display_value(sym) == ":my_symbol"
    end

    @testset "Inspect Bytes/UInt8 Array" begin
        bytes = UInt8[0x48, 0x65, 0x6c, 0x6c, 0x6f]  # "Hello"
        @test Positron.get_variable_kind(bytes) == Positron.VariableKind_Collection
        @test Positron.get_variable_length(bytes) == 5

        # Could be detected as Bytes kind in the future
        # For now it's a collection
    end

    @testset "Get Children - Edge Cases" begin
        # Scalar types have no children
        @test length(Positron.get_children(42)) == 0
        @test length(Positron.get_children("hello")) == 0
        @test length(Positron.get_children(true)) == 0

        # Nothing/missing have no children
        @test length(Positron.get_children(nothing)) == 0
        @test length(Positron.get_children(missing)) == 0
    end

    @testset "Size Calculation" begin
        # Scalar types
        @test Positron.get_variable_size(42) > 0
        @test Positron.get_variable_size(3.14) > 0
        @test Positron.get_variable_size("hello") > 0

        # Collections - size should scale with content
        small_vec = [1, 2, 3]
        large_vec = zeros(10000)
        @test Positron.get_variable_size(large_vec) > Positron.get_variable_size(small_vec)

        # String size scales with length
        short_str = "hi"
        long_str = "a"^1000
        @test Positron.get_variable_size(long_str) > Positron.get_variable_size(short_str)
    end

    @testset "Display Value Truncation" begin
        # Very long string should be truncated
        very_long = "a"^2000
        displayed = Positron.get_display_value(very_long)
        @test length(displayed) <= 1004  # 1000 chars + "..." + quotes

        # Very long array display might be truncated by show()
        long_arr = collect(1:1000)
        displayed_arr = Positron.get_display_value(long_arr)
        # Julia's show with :limit => true will truncate automatically
        @test length(displayed_arr) < 5000  # Should be much shorter than full repr
    end

    @testset "Display Type Truncation" begin
        # Create a type with a very long name
        struct AVeryLongTypeNameThatExceedsTheFiftyCharacterLimitForDisplayPurposes
            x::Int
        end

        obj = AVeryLongTypeNameThatExceedsTheFiftyCharacterLimitForDisplayPurposes(1)
        type_str = Positron.get_display_type(obj)
        @test length(type_str) <= 53  # 50 + "..."
    end

    @testset "Nested Value Access" begin
        # Create nested structure
        nested = Dict("level1" => Dict("level2" => Dict("level3" => [1, 2, 3])))

        @eval Main test_nested = $nested

        # Access deeply nested value
        value = Positron.get_value_at_path(["test_nested", "level1", "level2", "level3"])
        @test value == [1, 2, 3]

        # Access intermediate level
        value2 = Positron.get_value_at_path(["test_nested", "level1", "level2"])
        @test haskey(value2, "level3")
    end

    @testset "Array of Structs" begin
        struct Person
            name::String
            age::Int
        end

        people = [Person("Alice", 30), Person("Bob", 25), Person("Charlie", 35)]

        @test Positron.get_variable_kind(people) == Positron.VariableKind_Collection
        @test Positron.get_variable_length(people) == 3

        children = Positron.get_children(people)
        @test length(children) == 3

        # First person
        first_person = children[1]
        @test first_person.has_children == true

        # Access first person's fields
        @eval Main test_people = $people
        alice = Positron.get_value_at_path(["test_people", "1"])
        @test alice.name == "Alice"
        @test alice.age == 30
    end

    @testset "Nested Struct Path Navigation" begin
        # Define nested structs
        struct InnerPoint
            x::Float64
            y::Float64
        end

        struct OuterBox
            origin::InnerPoint
            size::InnerPoint
            label::String
        end

        box = OuterBox(InnerPoint(0.0, 0.0), InnerPoint(10.0, 20.0), "MyBox")
        @eval Main test_box = $box

        # Navigate to nested struct
        origin = Positron.get_value_at_path(["test_box", "origin"])
        @test origin isa InnerPoint
        @test origin.x == 0.0

        # Navigate to nested field via get_child_value
        origin_x = Positron.get_child_value(box, "origin")
        @test origin_x isa InnerPoint

        # Get children of nested struct
        origin_children = Positron.get_children(origin)
        @test length(origin_children) == 2
        x_child = filter(c -> c.display_name == "x", origin_children)[1]
        @test x_child.display_value == "0.0"
        @test x_child.has_children == false

        # Verify parent struct children include nested structs
        box_children = Positron.get_children(box)
        @test length(box_children) == 3
        origin_child = filter(c -> c.display_name == "origin", box_children)[1]
        @test origin_child.has_children == true
        @test occursin("InnerPoint", origin_child.display_type)
    end

    @testset "Parametric Structs" begin
        struct Wrapper{T}
            value::T
            metadata::String
        end

        # Wrapper with Int
        int_wrapper = Wrapper(42, "integer")
        @test Positron.value_has_children(int_wrapper) == true

        children = Positron.get_children(int_wrapper)
        @test length(children) == 2

        value_child = filter(c -> c.display_name == "value", children)[1]
        @test value_child.display_value == "42"
        @test value_child.has_children == false

        # Wrapper with Vector
        vec_wrapper = Wrapper([1, 2, 3], "vector")
        vec_children = Positron.get_children(vec_wrapper)
        vec_value_child = filter(c -> c.display_name == "value", vec_children)[1]
        @test vec_value_child.has_children == true  # Vector has children

        # Wrapper with nested Wrapper
        nested_wrapper = Wrapper(Wrapper(99, "inner"), "outer")
        nested_children = Positron.get_children(nested_wrapper)
        nested_value = filter(c -> c.display_name == "value", nested_children)[1]
        @test nested_value.has_children == true  # Inner Wrapper has children
    end

    @testset "Structs with Special Field Types" begin
        struct SpecialFields
            required::Int
            optional::Union{String,Nothing}
            maybe_missing::Union{Float64,Missing}
            any_value::Any
        end

        # With all values present
        full = SpecialFields(1, "present", 3.14, [1, 2, 3])
        children = Positron.get_children(full)
        @test length(children) == 4

        optional_child = filter(c -> c.display_name == "optional", children)[1]
        @test optional_child.display_value == "\"present\""

        any_child = filter(c -> c.display_name == "any_value", children)[1]
        @test any_child.has_children == true  # Vector has children

        # With nothing
        with_nothing = SpecialFields(1, nothing, 3.14, "string")
        nothing_children = Positron.get_children(with_nothing)
        optional_nothing = filter(c -> c.display_name == "optional", nothing_children)[1]
        @test optional_nothing.display_value == "nothing"
        @test optional_nothing.has_children == false

        # With missing
        with_missing = SpecialFields(1, "present", missing, nothing)
        missing_children = Positron.get_children(with_missing)
        maybe_missing_child = filter(c -> c.display_name == "maybe_missing", missing_children)[1]
        @test maybe_missing_child.display_value == "missing"
        @test maybe_missing_child.has_children == false
    end

    @testset "Struct with Many Fields" begin
        struct ManyFields
            a::Int
            b::Int
            c::Int
            d::Int
            e::Int
            f::String
            g::String
            h::Float64
            i::Bool
            j::Vector{Int}
        end

        obj = ManyFields(1, 2, 3, 4, 5, "f", "g", 8.0, true, [10, 11])

        children = Positron.get_children(obj)
        @test length(children) == 10

        # Verify all fields are present
        names = Set([c.display_name for c in children])
        @test "a" in names
        @test "j" in names

        # Verify types are correct
        j_child = filter(c -> c.display_name == "j", children)[1]
        @test j_child.has_children == true
        @test occursin("Vector", j_child.display_type)
    end

    @testset "Inspect DataFrame - Basic" begin
        df = DataFrame(
            id = 1:5,
            name = ["Alice", "Bob", "Charlie", "Diana", "Eve"],
            age = [30, 25, 35, 28, 32],
        )

        # DataFrames should be detected as tables
        @test Positron.is_table_like(df) == true
        @test Positron.get_variable_kind(df) == Positron.VariableKind_Table

        # DataFrames should be viewable in data explorer
        @test Positron.value_has_viewer(df) == true

        # Should report number of rows
        @test Positron.get_variable_length(df) == 5

        # Should have some size
        @test Positron.get_variable_size(df) > 0
    end

    @testset "Inspect DataFrame - Empty" begin
        df_empty = DataFrame()

        @test Positron.is_table_like(df_empty) == true
        @test Positron.get_variable_kind(df_empty) == Positron.VariableKind_Table
        @test Positron.get_variable_length(df_empty) == 0
    end

    @testset "Inspect DataFrame - Large" begin
        df_large = DataFrame(
            id = 1:1000,
            value = rand(1000),
            category = rand(["A", "B", "C"], 1000),
        )

        @test Positron.get_variable_kind(df_large) == Positron.VariableKind_Table
        @test Positron.get_variable_length(df_large) == 1000
        @test Positron.value_has_viewer(df_large) == true
    end

    @testset "Inspect DataFrame - With Missing" begin
        df = DataFrame(x = [1, 2, missing, 4], y = [missing, "b", "c", "d"])

        @test Positron.get_variable_kind(df) == Positron.VariableKind_Table
        @test Positron.get_variable_length(df) == 4
        @test Positron.value_has_viewer(df) == true
    end

    @testset "Inspect DataFrame - Wide" begin
        # DataFrame with many columns
        df_wide = DataFrame([Symbol("col$i") => rand(5) for i = 1:50])

        @test Positron.get_variable_kind(df_wide) == Positron.VariableKind_Table
        @test Positron.get_variable_length(df_wide) == 5
    end

    @testset "Inspect DataFrame - Single Row/Column" begin
        df_single_row = DataFrame(a = [1], b = ["one"])
        @test Positron.get_variable_kind(df_single_row) == Positron.VariableKind_Table
        @test Positron.get_variable_length(df_single_row) == 1

        df_single_col = DataFrame(values = 1:10)
        @test Positron.get_variable_kind(df_single_col) == Positron.VariableKind_Table
        @test Positron.get_variable_length(df_single_col) == 10
    end

    @testset "Inspect DataFrame - Has Children" begin
        df = DataFrame(a = [1, 2, 3], b = ["x", "y", "z"])
        @test Positron.value_has_children(df) == true

        # Empty DataFrame has no children
        df_empty = DataFrame()
        @test Positron.value_has_children(df_empty) == false
    end

    @testset "Inspect DataFrame - Get Children (Columns)" begin
        df = DataFrame(a = [1, 2, 3], b = ["x", "y", "z"], c = [1.0, 2.0, 3.0])
        children = Positron.get_children(df)

        # Children should be the columns, not rows
        @test length(children) == 3

        # Children should be named by column names
        names = [c.display_name for c in children]
        @test "a" in names
        @test "b" in names
        @test "c" in names

        # First column should be an array of integers
        a_child = children[findfirst(c -> c.display_name == "a", children)]
        @test a_child.kind == Positron.VariableKind_Collection
        @test a_child.length == 3
        @test a_child.has_children == true
    end

    @testset "Inspect DataFrame - Get Child Value (Column Access)" begin
        df = DataFrame(a = [1, 2, 3], b = ["x", "y", "z"])

        # Get column by name
        col_a = Positron.get_child_value(df, "a")
        @test col_a == [1, 2, 3]

        col_b = Positron.get_child_value(df, "b")
        @test col_b == ["x", "y", "z"]

        # Non-existent column returns nothing
        @test Positron.get_child_value(df, "nonexistent") === nothing
    end

    @testset "Inspect DataFrame - Path Navigation" begin
        @eval Main test_df = DataFrame(nums = [10, 20, 30], strs = ["a", "b", "c"])

        # Access column via path
        col = Positron.get_value_at_path(["test_df", "nums"])
        @test col == [10, 20, 30]

        # Access element within column
        elem = Positron.get_value_at_path(["test_df", "nums", "[2]"])
        @test elem == 20
    end

    @testset "Inspect DataFrame - Display Value and Type" begin
        df = DataFrame(a = [1, 2, 3], b = ["x", "y", "z"])

        # Display value should show dimensions
        display_val = Positron.get_display_value(df)
        @test occursin("3", display_val)  # 3 rows
        @test occursin("2", display_val)  # 2 columns
        @test occursin("DataFrame", display_val)

        # Display type should include dimensions
        display_type = Positron.get_display_type(df)
        @test occursin("DataFrame", display_type)
        @test occursin("3", display_type)  # rows
        @test occursin("2", display_type)  # columns
    end

    @testset "Inspect DataFrame - Wide DataFrame Children" begin
        # DataFrame with many columns (>100 should be truncated)
        df_wide = DataFrame([Symbol("col$i") => [i] for i = 1:150])

        children = Positron.get_children(df_wide)

        # Should be limited to 100 children
        @test length(children) == 100
    end
end
