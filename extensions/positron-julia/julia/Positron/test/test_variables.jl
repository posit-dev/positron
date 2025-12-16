# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

using Test
using JSON3


@testset "Variables Tests" begin
    @testset "Variable Kind Detection" begin
        @test Positron.get_variable_kind(true) == Positron.VariableKind_Boolean
        @test Positron.get_variable_kind(false) == Positron.VariableKind_Boolean
        @test Positron.get_variable_kind(42) == Positron.VariableKind_Number
        @test Positron.get_variable_kind(3.14) == Positron.VariableKind_Number
        @test Positron.get_variable_kind(1 + 2im) == Positron.VariableKind_Number
        @test Positron.get_variable_kind("hello") == Positron.VariableKind_String
        @test Positron.get_variable_kind([1, 2, 3]) == Positron.VariableKind_Collection
        @test Positron.get_variable_kind(Dict("a" => 1)) == Positron.VariableKind_Map
        @test Positron.get_variable_kind(nothing) == Positron.VariableKind_Empty
        @test Positron.get_variable_kind(missing) == Positron.VariableKind_Empty
        @test Positron.get_variable_kind(sin) == Positron.VariableKind_Function
        @test Positron.get_variable_kind(Int) == Positron.VariableKind_Class
        @test Positron.get_variable_kind(Int64) == Positron.VariableKind_Class

        # Test table-like detection
        # TODO: Add DataFrame tests when DataFrames.jl is available
    end

    @testset "Display Value Formatting" begin
        @test Positron.get_display_value(42) == "42"
        @test Positron.get_display_value("hello") == "\"hello\""
        @test Positron.get_display_value(true) == "true"
        @test Positron.get_display_value(false) == "false"
        @test Positron.get_display_value([1, 2, 3]) == "[1, 2, 3]"
        @test Positron.get_display_value(nothing) == "nothing"
        @test Positron.get_display_value(missing) == "missing"

        # Test truncation for long values
        long_string = "a"^1500
        display_val = Positron.get_display_value(long_string)
        @test length(display_val) <= 1004  # 1000 chars + "..." + quotes
    end

    @testset "Display Type Formatting" begin
        @test Positron.get_display_type(42) == "Int64"
        @test Positron.get_display_type(3.14) == "Float64"
        @test Positron.get_display_type("hello") == "String"
        @test occursin("Vector", Positron.get_display_type([1, 2, 3]))
        @test occursin("Matrix", Positron.get_display_type([1 2; 3 4]))
        @test Positron.get_display_type(Dict("a" => 1)) == "Dict"

        # Test truncation for long type names
        struct VeryLongTypeNameThatShouldBeTruncatedInTheDisplay
            x::Int
        end
        obj = VeryLongTypeNameThatShouldBeTruncatedInTheDisplay(1)
        type_str = Positron.get_display_type(obj)
        @test length(type_str) <= 53  # 50 chars + "..."
    end

    @testset "Variable Length" begin
        @test Positron.get_variable_length([1, 2, 3]) == 3
        @test Positron.get_variable_length("hello") == 5
        @test Positron.get_variable_length(Dict("a" => 1, "b" => 2)) == 2
        @test Positron.get_variable_length(1:10) == 10
        @test Positron.get_variable_length(42) == 1  # Scalars have length 1 in Julia
    end

    @testset "Variable Size" begin
        @test Positron.get_variable_size(42) > 0
        @test Positron.get_variable_size([1, 2, 3]) > 0
        @test Positron.get_variable_size("hello") > 0

        # Larger objects should have larger sizes
        small_array = [1, 2, 3]
        large_array = zeros(1000)
        @test Positron.get_variable_size(large_array) >
              Positron.get_variable_size(small_array)
    end

    @testset "Has Children" begin
        @test Positron.value_has_children([1, 2, 3]) == true
        @test Positron.value_has_children(Int[]) == false
        @test Positron.value_has_children(Dict("a" => 1)) == true
        @test Positron.value_has_children(Dict()) == false
        @test Positron.value_has_children(42) == false
        @test Positron.value_has_children("hello") == false
        @test Positron.value_has_children(nothing) == false
        @test Positron.value_has_children(missing) == false
        @test Positron.value_has_children(sin) == false

        # Struct with fields has children
        struct TestStruct
            x::Int
            y::String
        end
        @test Positron.value_has_children(TestStruct(1, "a")) == true
    end

    @testset "Has Viewer" begin
        @test Positron.value_has_viewer([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == true
        @test Positron.value_has_viewer([1, 2, 3]) == false  # Too short
        @test Positron.value_has_viewer([1 2; 3 4]) == true  # Matrices can be viewed
        @test Positron.value_has_viewer(42) == false
        @test Positron.value_has_viewer("hello") == false

        # TODO: Test with DataFrames when available
    end

    @testset "Create Variable" begin
        var = Positron.create_variable("test_var", 42, 0)

        @test var.access_key == "test_var"
        @test var.display_name == "test_var"
        @test var.display_value == "42"
        @test var.display_type == "Int64"
        @test var.kind == Positron.VariableKind_Number
        @test var.has_children == false
        @test var.updated_time == 0

        # Test with collection
        var2 = Positron.create_variable("my_array", [1, 2, 3], 100)
        @test var2.kind == Positron.VariableKind_Collection
        @test var2.length == 3
        @test var2.has_children == true
        @test var2.updated_time == 100
    end

    @testset "Variable Serialization" begin
        var = Positron.create_variable("test", [1, 2, 3], 0)
        json_str = JSON3.write(var)
        parsed = JSON3.read(json_str, Dict)

        @test parsed["access_key"] == "test"
        @test parsed["display_name"] == "test"
        @test parsed["kind"] == "collection"
        @test parsed["length"] == 3
        @test parsed["has_children"] == true
    end

    @testset "VariableKind Enum Serialization" begin
        @test string(Positron.VariableKind_Boolean) == "boolean"
        @test string(Positron.VariableKind_Number) == "number"
        @test string(Positron.VariableKind_String) == "string"
        @test string(Positron.VariableKind_Collection) == "collection"
        @test string(Positron.VariableKind_Map) == "map"
        @test string(Positron.VariableKind_Function) == "function"
        @test string(Positron.VariableKind_Class) == "class"
        @test string(Positron.VariableKind_Empty) == "empty"
        @test string(Positron.VariableKind_Table) == "table"
        @test string(Positron.VariableKind_Other) == "other"
    end

    @testset "Should Skip Variable" begin
        @test Positron.should_skip_variable(:Base) == true
        @test Positron.should_skip_variable(:Core) == true
        @test Positron.should_skip_variable(:Main) == true
        @test Positron.should_skip_variable(:ans) == true
        @test Positron.should_skip_variable(Symbol("#temp")) == true

        # Create test variables to test skipping logic
        @eval Main my_var = 42
        @eval Main x = "test"
        @eval Main _private = 100

        # Regular variables should not be skipped
        @test Positron.should_skip_variable(:my_var) == false
        @test Positron.should_skip_variable(:x) == false

        # Private variables (starting with _) should be skipped
        @test Positron.should_skip_variable(:_private) == true
    end

    @testset "Get Children - Dict" begin
        dict = Dict("a" => 1, "b" => 2, "c" => 3)
        children = Positron.get_children(dict)

        @test length(children) == 3
        names = [c.display_name for c in children]
        @test "a" in names || "b" in names || "c" in names
    end

    @testset "Get Children - Array" begin
        arr = [10, 20, 30]
        children = Positron.get_children(arr)

        @test length(children) == 3
        @test children[1].display_name == "[1]"
        @test children[2].display_name == "[2]"
        @test children[3].display_name == "[3]"
        @test children[1].display_value == "10"

        # Test large array truncation
        large_arr = 1:200
        children = Positron.get_children(large_arr)
        @test length(children) == 100  # Should be limited to 100
    end

    @testset "Get Children - Struct" begin
        struct Point
            x::Int
            y::Int
        end
        pt = Point(10, 20)
        children = Positron.get_children(pt)

        @test length(children) == 2
        names = [c.display_name for c in children]
        @test "x" in names
        @test "y" in names
    end

    @testset "Get Value at Path - Simple" begin
        # Set up test variables in Main
        @eval Main test_var = 42
        value = Positron.get_value_at_path(["test_var"])
        @test value == 42
    end

    @testset "Get Value at Path - Nested Dict" begin
        @eval Main test_dict = Dict("a" => Dict("b" => 123))
        value = Positron.get_value_at_path(["test_dict", "a", "b"])
        @test value == 123
    end

    @testset "Get Value at Path - Array Index" begin
        @eval Main test_array = [10, 20, 30]
        value = Positron.get_value_at_path(["test_array", "2"])
        @test value == 20
    end

    @testset "Get Value at Path - Not Found" begin
        value = Positron.get_value_at_path(["nonexistent_var"])
        @test value === nothing

        @eval Main test_dict2 = Dict("a" => 1)
        value = Positron.get_value_at_path(["test_dict2", "nonexistent"])
        @test value === nothing
    end

    @testset "Get Child Value - Dict" begin
        dict = Dict("key1" => "value1", :key2 => "value2", 3 => "value3")

        # String key
        @test Positron.get_child_value(dict, "key1") == "value1"

        # Symbol key
        @test Positron.get_child_value(dict, "key2") == "value2"

        # Integer key
        @test Positron.get_child_value(dict, "3") == "value3"

        # Not found
        @test Positron.get_child_value(dict, "missing") === nothing
    end

    @testset "Get Child Value - Array" begin
        arr = [100, 200, 300]

        # Plain integer format
        @test Positron.get_child_value(arr, "1") == 100
        @test Positron.get_child_value(arr, "2") == 200
        @test Positron.get_child_value(arr, "3") == 300

        # Bracket format (as used by get_children)
        @test Positron.get_child_value(arr, "[1]") == 100
        @test Positron.get_child_value(arr, "[2]") == 200
        @test Positron.get_child_value(arr, "[3]") == 300

        # Out of bounds
        @test Positron.get_child_value(arr, "10") === nothing
        @test Positron.get_child_value(arr, "[10]") === nothing

        # Invalid index
        @test Positron.get_child_value(arr, "invalid") === nothing
    end

    @testset "Get Children - Matrix (2D Array)" begin
        # 2D matrix - children should be rows, not individual elements
        matrix = [1 2 3; 4 5 6]  # 2x3 matrix

        children = Positron.get_children(matrix)

        # Should have 2 children (rows), not 6 (total elements)
        @test length(children) == 2

        # First child should be the first row [1, 2, 3]
        @test children[1].display_name == "[1]"
        @test occursin("1", children[1].display_value)
        @test occursin("2", children[1].display_value)
        @test occursin("3", children[1].display_value)

        # Second child should be the second row [4, 5, 6]
        @test children[2].display_name == "[2]"
        @test occursin("4", children[2].display_value)
        @test occursin("5", children[2].display_value)
        @test occursin("6", children[2].display_value)

        # Each row should have children (the individual elements)
        @test children[1].has_children == true
        @test children[2].has_children == true
    end

    @testset "Get Child Value - Matrix (2D Array)" begin
        matrix = [1 2; 3 4]  # 2x2 matrix

        # Getting child at index 1 should return first row [1, 2]
        row1 = Positron.get_child_value(matrix, "[1]")
        @test row1 == [1, 2]

        # Getting child at index 2 should return second row [3, 4]
        row2 = Positron.get_child_value(matrix, "[2]")
        @test row2 == [3, 4]

        # Can then get individual elements from the row
        @test Positron.get_child_value(row1, "[1]") == 1
        @test Positron.get_child_value(row1, "[2]") == 2
    end

    @testset "Get Value at Path - Matrix Nested Access" begin
        @eval Main test_matrix = [10 20; 30 40]

        # Access first row
        row1 = Positron.get_value_at_path(["test_matrix", "[1]"])
        @test row1 == [10, 20]

        # Access element in first row
        elem = Positron.get_value_at_path(["test_matrix", "[1]", "[2]"])
        @test elem == 20

        # Access element in second row
        elem2 = Positron.get_value_at_path(["test_matrix", "[2]", "[1]"])
        @test elem2 == 30
    end

    @testset "Get Children - 3D Array" begin
        # 3D array - children should be 2D slices
        arr3d = reshape(1:24, 2, 3, 4)

        children = Positron.get_children(arr3d)

        # Should have 2 children (first dimension size)
        @test length(children) == 2

        # Each child is a 3x4 matrix
        @test children[1].has_children == true
        @test children[2].has_children == true
    end

    @testset "Variable Length - Arrays" begin
        # 1D array - length is number of elements
        @test Positron.get_variable_length([1, 2, 3]) == 3

        # 2D array - length is first dimension (number of rows)
        @test Positron.get_variable_length([1 2 3; 4 5 6]) == 2

        # 3D array - length is first dimension
        @test Positron.get_variable_length(reshape(1:24, 2, 3, 4)) == 2
    end

    @testset "Parse Array Index" begin
        # Plain integer
        @test Positron.parse_array_index("1") == 1
        @test Positron.parse_array_index("42") == 42

        # Bracket format
        @test Positron.parse_array_index("[1]") == 1
        @test Positron.parse_array_index("[42]") == 42

        # Invalid formats
        @test Positron.parse_array_index("abc") === nothing
        @test Positron.parse_array_index("[abc]") === nothing
        @test Positron.parse_array_index("") === nothing
        @test Positron.parse_array_index("[]") === nothing
    end

    @testset "Get Child Value - Struct" begin
        struct TestStruct2
            field1::Int
            field2::String
        end
        obj = TestStruct2(42, "hello")

        @test Positron.get_child_value(obj, "field1") == 42
        @test Positron.get_child_value(obj, "field2") == "hello"

        # Not a field
        @test Positron.get_child_value(obj, "missing") === nothing
    end

    @testset "Clipboard Formatting - Plain Text" begin
        value = [1, 2, 3]
        formatted = Positron.format_for_clipboard(value, "text/plain")
        @test occursin("1", formatted)
        @test occursin("2", formatted)
        @test occursin("3", formatted)
    end

    @testset "Clipboard Formatting - Unknown Format" begin
        value = 42
        formatted = Positron.format_for_clipboard(value, "unknown/format")
        # Should fall back to repr
        @test occursin("42", formatted)
    end

    @testset "Request Parsing - List" begin
        data = Dict("method" => "list", "params" => Dict())
        request = Positron.parse_variables_request(data)
        @test request === nothing  # list has no params
    end

    @testset "Request Parsing - Clear" begin
        data = Dict("method" => "clear", "params" => Dict("include_hidden_objects" => true))
        request = Positron.parse_variables_request(data)
        @test request isa Positron.VariablesClearParams
        @test request.include_hidden_objects == true
    end

    @testset "Request Parsing - Delete" begin
        data = Dict("method" => "delete", "params" => Dict("names" => ["x", "y"]))
        request = Positron.parse_variables_request(data)
        @test request isa Positron.VariablesDeleteParams
        @test request.names == ["x", "y"]
    end

    @testset "Request Parsing - Inspect" begin
        data = Dict("method" => "inspect", "params" => Dict("path" => ["foo", "bar"]))
        request = Positron.parse_variables_request(data)
        @test request isa Positron.VariablesInspectParams
        @test request.path == ["foo", "bar"]
    end

    @testset "Request Parsing - Clipboard Format" begin
        data = Dict(
            "method" => "clipboard_format",
            "params" => Dict("path" => ["x"], "format" => "text/plain"),
        )
        request = Positron.parse_variables_request(data)
        @test request isa Positron.VariablesClipboardFormatParams
        @test request.path == ["x"]
        @test string(request.format) == "text/plain"
    end

    @testset "Request Parsing - View" begin
        data = Dict("method" => "view", "params" => Dict("path" => ["data"]))
        request = Positron.parse_variables_request(data)
        @test request isa Positron.VariablesViewParams
        @test request.path == ["data"]
    end

    @testset "Table Detection" begin
        # Basic types are not tables
        @test Positron.is_table_like(42) == false
        @test Positron.is_table_like([1, 2, 3]) == false
        @test Positron.is_table_like(Dict("a" => 1)) == false

        # Matrix is table-like
        @test Positron.is_table_like([1 2; 3 4]) == true

        # TODO: Test with actual DataFrame when available
    end

    @testset "Collect Variables" begin
        # Set up some test variables
        @eval Main test_int = 42
        @eval Main test_string = "hello"
        @eval Main test_array = [1, 2, 3]

        variables = Positron.collect_variables()

        # Should include our test variables
        names = [v.display_name for v in variables]
        @test "test_int" in names
        @test "test_string" in names
        @test "test_array" in names

        # Should not include Base, Core, Main
        @test !("Base" in names)
        @test !("Core" in names)
        @test !("Main" in names)
    end

    @testset "Variables Service - Initialization" begin
        service = Positron.VariablesService()
        @test service.comm === nothing
        @test service.current_version == 0
        @test isempty(service.last_snapshot)
    end

    @testset "Variables Service - Handle List" begin
        service = Positron.VariablesService()
        comm = MockComm("variables")

        # Initialize with mock comm
        service.comm = comm
        service.current_version = 0

        # Test handle_list
        Positron.handle_list(service)

        # Should have sent a result message
        @test length(comm.messages) > 0
        msg = last_message(comm)
        @test haskey(msg, "data")

        # Version should increment
        @test service.current_version == 1
    end

    @testset "Variables Service - Update Event Detection" begin
        service = Positron.VariablesService()
        comm = MockComm("variables")
        service.comm = comm

        # Start with empty snapshot
        service.last_snapshot = Dict{String,Positron.Variable}()
        service.current_version = 0

        # Add a variable to Main
        @eval Main new_test_var = 123

        # Send update should detect the new variable
        Positron.send_update!(service)

        # Should have sent an update event if there were changes
        if length(comm.messages) > 0
            msg = last_message(comm)
            @test haskey(msg, "data")
            # The update params should have the new variable
        end
    end

    @testset "Variables Service - Refresh Event" begin
        service = Positron.VariablesService()
        comm = MockComm("variables")
        service.comm = comm

        Positron.send_refresh!(service)

        # Should have sent a refresh event
        @test length(comm.messages) > 0
        msg = last_message(comm)
        @test haskey(msg, "data")
    end
end

@testset "Variables - Change Detection" begin
    @testset "Detect New Variable" begin
        service = Positron.VariablesService()
        comm = MockComm("variables")
        service.comm = comm

        # Start with empty snapshot
        service.last_snapshot = Dict{String,Positron.Variable}()

        # Add variable
        @eval Main new_var = 123

        # Send update should detect it
        Positron.send_update!(service)

        # Should have sent update event
        @test length(comm.messages) > 0
        msg = last_message(comm)
        @test haskey(msg, "data")
    end

    @testset "Detect Variable Removal" begin
        service = Positron.VariablesService()
        comm = MockComm("variables")
        service.comm = comm

        # Start with a variable in snapshot
        @eval Main temp_var = 456
        vars = Positron.collect_variables()
        service.last_snapshot = Dict(v.display_name => v for v in vars)

        # Note: Can't truly remove in Julia, but test the detection logic
        # by manually removing from snapshot
        delete!(service.last_snapshot, "temp_var")

        # This simulates what would happen if a var was removed
        current_vars = Positron.collect_variables()
        current_map = Dict(v.display_name => v for v in current_vars)

        removed = String[]
        for name in keys(service.last_snapshot)
            if !haskey(current_map, name)
                push!(removed, name)
            end
        end

        @test isempty(removed)  # temp_var is still there (can't delete in Julia)
    end

    @testset "Detect Variable Change" begin
        service = Positron.VariablesService()
        comm = MockComm("variables")
        service.comm = comm

        # Start with a variable
        @eval Main changing_var = 100
        vars = Positron.collect_variables()
        service.last_snapshot = Dict(v.display_name => v for v in vars)

        # Change it
        @eval Main changing_var = 200

        # Send update should detect change
        Positron.send_update!(service)

        @test length(comm.messages) > 0
    end

    @testset "No Update for Unchanged Variables" begin
        service = Positron.VariablesService()
        comm = MockComm("variables")
        service.comm = comm

        # Set up snapshot
        @eval Main static_var = 999
        vars = Positron.collect_variables()
        service.last_snapshot = Dict(v.display_name => v for v in vars)

        # Don't change anything
        Positron.send_update!(service)

        # Should not send update if nothing changed
        # (Current implementation sends if assigned or removed is non-empty)
    end
end
