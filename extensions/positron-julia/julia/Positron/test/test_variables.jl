# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

using Test

function test_variables()
	@testset "Variable kind detection" begin
		@test Positron.get_variable_kind(true) == Positron.VK_Boolean
		@test Positron.get_variable_kind(false) == Positron.VK_Boolean
		@test Positron.get_variable_kind(42) == Positron.VK_Number
		@test Positron.get_variable_kind(3.14) == Positron.VK_Number
		@test Positron.get_variable_kind("hello") == Positron.VK_String
		@test Positron.get_variable_kind([1, 2, 3]) == Positron.VK_Collection
		@test Positron.get_variable_kind(Dict("a" => 1)) == Positron.VK_Map
		@test Positron.get_variable_kind(nothing) == Positron.VK_Empty
		@test Positron.get_variable_kind(missing) == Positron.VK_Empty
		@test Positron.get_variable_kind(sin) == Positron.VK_Function
		@test Positron.get_variable_kind(Int) == Positron.VK_Class
	end

	@testset "Display value" begin
		@test Positron.get_display_value(42) == "42"
		@test Positron.get_display_value("hello") == "\"hello\""
		@test Positron.get_display_value(true) == "true"
		@test Positron.get_display_value([1, 2, 3]) == "[1, 2, 3]"
	end

	@testset "Display type" begin
		@test Positron.get_display_type(42) == "Int64"
		@test Positron.get_display_type(3.14) == "Float64"
		@test Positron.get_display_type("hello") == "String"
		@test occursin("Vector", Positron.get_display_type([1, 2, 3]))
		@test Positron.get_display_type(Dict("a" => 1)) == "Dict"
	end

	@testset "Variable length" begin
		@test Positron.get_variable_length([1, 2, 3]) == 3
		@test Positron.get_variable_length("hello") == 5
		@test Positron.get_variable_length(Dict("a" => 1, "b" => 2)) == 2
	end

	@testset "Has children" begin
		@test Positron.value_has_children([1, 2, 3]) == true
		@test Positron.value_has_children(Int[]) == false
		@test Positron.value_has_children(Dict("a" => 1)) == true
		@test Positron.value_has_children(Dict()) == false
		@test Positron.value_has_children(42) == false
		@test Positron.value_has_children("hello") == false
	end

	@testset "Create variable" begin
		var = Positron.create_variable("test_var", 42, 0)

		@test var.access_key == "test_var"
		@test var.display_name == "test_var"
		@test var.display_value == "42"
		@test var.kind == Positron.VK_Number
		@test var.has_children == false
	end

	@testset "Variable serialization" begin
		var = Positron.create_variable("test", [1, 2, 3], 0)
		json_str = JSON3.write(var)
		parsed = JSON3.read(json_str)

		@test parsed["access_key"] == "test"
		@test parsed["display_name"] == "test"
		@test parsed["kind"] == "collection"
		@test parsed["length"] == 3
	end

	@testset "VariableKind enum serialization" begin
		@test string(Positron.VK_Boolean) == "boolean"
		@test string(Positron.VK_Number) == "number"
		@test string(Positron.VK_String) == "string"
		@test string(Positron.VK_Collection) == "collection"
	end

	@testset "Request parsing" begin
		# Test list request
		list_data = Dict("method" => "list", "params" => Dict())
		req = Positron.parse_variables_request(list_data)
		@test req isa Positron.ListRequest

		# Test clear request
		clear_data = Dict("method" => "clear", "params" => Dict("include_hidden_objects" => true))
		req = Positron.parse_variables_request(clear_data)
		@test req isa Positron.ClearRequest
		@test req.include_hidden_objects == true

		# Test inspect request
		inspect_data = Dict("method" => "inspect", "params" => Dict("path" => ["foo", "bar"]))
		req = Positron.parse_variables_request(inspect_data)
		@test req isa Positron.InspectRequest
		@test req.path == ["foo", "bar"]

		# Test delete request
		delete_data = Dict("method" => "delete", "params" => Dict("names" => ["x", "y"]))
		req = Positron.parse_variables_request(delete_data)
		@test req isa Positron.DeleteRequest
		@test req.names == ["x", "y"]
	end

	@testset "Get children" begin
		# Dict children
		dict = Dict("a" => 1, "b" => 2)
		children = Positron.get_children(dict)
		@test length(children) == 2

		# Array children
		arr = [10, 20, 30]
		children = Positron.get_children(arr)
		@test length(children) == 3
		@test children[1].display_name == "[1]"

		# Struct children
		struct TestStruct
			x::Int
			y::String
		end
		obj = TestStruct(42, "hello")
		children = Positron.get_children(obj)
		@test length(children) == 2
	end
end
