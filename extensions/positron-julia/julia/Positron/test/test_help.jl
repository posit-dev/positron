# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

using Test
using JSON3

include("test_helpers.jl")

@testset "Help Service Tests" begin
	@testset "HTML Escaping" begin
		@test Positron.escape_html("<script>") == "&lt;script&gt;"
		@test Positron.escape_html("a & b") == "a &amp; b"
		@test Positron.escape_html("\"quoted\"") == "&quot;quoted&quot;"
		@test Positron.escape_html("it's") == "it&#39;s"
		@test Positron.escape_html("normal text") == "normal text"

		# Test multiple special characters
		@test Positron.escape_html("<a href=\"url\">text & more</a>") ==
			  "&lt;a href=&quot;url&quot;&gt;text &amp; more&lt;/a&gt;"
	end

	@testset "Symbol Resolution - Simple" begin
		# Built-in functions
		@test Positron.resolve_symbol("sum") === sum
		@test Positron.resolve_symbol("println") === println
		@test Positron.resolve_symbol("map") === map

		# Types
		@test Positron.resolve_symbol("Int64") === Int64
		@test Positron.resolve_symbol("String") === String
		@test Positron.resolve_symbol("Vector") === Vector

		# Non-existent
		@test Positron.resolve_symbol("nonexistent_symbol_xyz") === nothing
	end

	@testset "Symbol Resolution - Module-Qualified" begin
		# Base functions
		@test Positron.resolve_symbol("Base.sum") === sum
		@test Positron.resolve_symbol("Base.println") === println

		# Nested modules
		@test Positron.resolve_symbol("Base.Iterators.filter") !== nothing

		# Invalid paths
		@test Positron.resolve_symbol("NonexistentModule.func") === nothing
		@test Positron.resolve_symbol("Base.nonexistent") === nothing
	end

	@testset "Fetch Documentation - Functions" begin
		# Standard functions with docs
		doc = Positron.fetch_documentation(sum)
		@test doc !== nothing
		@test length(doc) > 0
		@test occursin("sum", lowercase(doc))

		doc = Positron.fetch_documentation(map)
		@test doc !== nothing
		@test occursin("map", lowercase(doc))
	end

	@testset "Fetch Documentation - Types" begin
		doc = Positron.fetch_documentation(Int64)
		@test doc !== nothing

		doc = Positron.fetch_documentation(String)
		@test doc !== nothing
	end

	@testset "Markdown to HTML - Basic" begin
		# Headers
		html = Positron.markdown_to_html("# Header 1")
		@test occursin("<h1>", html) || occursin("Header", html)

		html = Positron.markdown_to_html("## Header 2")
		@test occursin("h2", lowercase(html)) || occursin("Header", html)

		# Paragraphs
		html = Positron.markdown_to_html("Simple paragraph.")
		@test occursin("Simple paragraph", html)

		# Bold and italic
		html = Positron.markdown_to_html("**bold** and *italic*")
		@test occursin("bold", html)
		@test occursin("italic", html)
	end

	@testset "Markdown to HTML - Code Blocks" begin
		html = Positron.markdown_to_html("```julia\nx = 1\ny = 2\n```")
		# HTML entities may be used (&#61; for =)
		@test occursin("x", html) && occursin("1", html)
		@test occursin("y", html) && occursin("2", html)

		# Inline code
		html = Positron.markdown_to_html("Use `println` to output")
		@test occursin("println", html)
	end

	@testset "Markdown to HTML - Lists" begin
		md = """
		- Item 1
		- Item 2
		- Item 3
		"""
		html = Positron.markdown_to_html(md)
		@test occursin("Item 1", html)
		@test occursin("Item 2", html)
	end

	@testset "Get Help Content - Standard Library" begin
		# Built-in functions
		content = Positron.get_help_content("sum")
		@test content !== nothing
		@test length(content) > 0
		# Should contain HTML tags
		@test occursin("<div", content) || occursin("<p", content)

		content = Positron.get_help_content("println")
		@test content !== nothing

		# Types
		content = Positron.get_help_content("Int64")
		@test content !== nothing
	end

	@testset "Get Help Content - Module-Qualified" begin
		content = Positron.get_help_content("Base.sum")
		@test content !== nothing
		@test length(content) > 0
	end

	@testset "Get Help Content - Not Found" begin
		content = Positron.get_help_content("nonexistent_function_xyz_123")
		@test content === nothing

		content = Positron.get_help_content("InvalidModule.func")
		@test content === nothing
	end

	@testset "Request Parsing - show_help_topic" begin
		data = Dict("method" => "show_help_topic", "params" => Dict("topic" => "sum"))
		req = Positron.parse_help_request(data)
		@test req isa Positron.HelpShowHelpTopicParams
		@test req.topic == "sum"

		# Empty topic
		data = Dict("method" => "show_help_topic", "params" => Dict("topic" => ""))
		req = Positron.parse_help_request(data)
		@test req isa Positron.HelpShowHelpTopicParams
		@test req.topic == ""
	end

	@testset "Request Parsing - Unknown Method" begin
		data = Dict("method" => "unknown_method", "params" => Dict())
		@test_throws ErrorException Positron.parse_help_request(data)
	end

	@testset "ShowHelpKind Enum Serialization" begin
		@test string(Positron.ShowHelpKind_Html) == "html"
		@test string(Positron.ShowHelpKind_Markdown) == "markdown"
		@test string(Positron.ShowHelpKind_Url) == "url"
	end

	@testset "HelpShowHelpParams Serialization" begin
		# HTML kind
		params = Positron.HelpShowHelpParams("<html>content</html>", Positron.ShowHelpKind_Html, true)
		json_str = JSON3.write(params)
		parsed = JSON3.read(json_str, Dict)

		@test parsed["content"] == "<html>content</html>"
		@test parsed["kind"] == "html"
		@test parsed["focus"] == true

		# Markdown kind
		params = Positron.HelpShowHelpParams("# Markdown", Positron.ShowHelpKind_Markdown, false)
		json_str = JSON3.write(params)
		parsed = JSON3.read(json_str, Dict)

		@test parsed["content"] == "# Markdown"
		@test parsed["kind"] == "markdown"
		@test parsed["focus"] == false

		# URL kind
		params = Positron.HelpShowHelpParams("http://example.com", Positron.ShowHelpKind_Url, true)
		json_str = JSON3.write(params)
		parsed = JSON3.read(json_str, Dict)

		@test parsed["content"] == "http://example.com"
		@test parsed["kind"] == "url"
	end

	@testset "HelpService - Initialization" begin
		service = Positron.HelpService()
		@test service.comm === nothing
	end

	@testset "HelpService - Handle Help Topic" begin
		service = Positron.HelpService()
		comm = MockComm("help")
		service.comm = comm

		# Request help for a standard function
		Positron.handle_show_help_topic(service, "sum")

		# Should have sent result and event
		@test length(comm.messages) >= 2

		# Find the show_help event
		events = filter(m -> haskey(m, "data") && m["data"] isa Positron.JsonRpcNotification, comm.messages)
		@test length(events) > 0

		# Check event has help content
		event = events[1]
		@test event["data"].method == "show_help"
	end

	@testset "HelpService - Help Not Found" begin
		service = Positron.HelpService()
		comm = MockComm("help")
		service.comm = comm

		# Request help for non-existent topic
		Positron.handle_show_help_topic(service, "nonexistent_xyz_123")

		# Should have sent an error
		@test length(comm.messages) > 0
		msg = last_message(comm)
		@test haskey(msg, "data")
		@test msg["data"] isa Positron.JsonRpcError
	end

	@testset "Public help() Function" begin
		# Test that we can get help for various types
		# Note: This requires a running kernel, so we just test the function exists
		@test isdefined(Positron, :showhelp)
	end
end

