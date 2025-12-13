# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

using Test

function test_help()
	@testset "Escape HTML" begin
		@test Positron.escape_html("<script>") == "&lt;script&gt;"
		@test Positron.escape_html("a & b") == "a &amp; b"
		@test Positron.escape_html("\"quoted\"") == "&quot;quoted&quot;"
		@test Positron.escape_html("it's") == "it&#39;s"
		@test Positron.escape_html("normal text") == "normal text"
	end

	@testset "Resolve symbol" begin
		# Test resolving Base functions
		sym = Positron.resolve_symbol("sum")
		@test sym !== nothing
		@test sym === sum

		# Test resolving module-qualified names
		sym = Positron.resolve_symbol("Base.sum")
		@test sym !== nothing
		@test sym === sum

		# Test non-existent symbol
		sym = Positron.resolve_symbol("nonexistent_symbol_xyz")
		@test sym === nothing
	end

	@testset "Fetch documentation" begin
		# Test getting docs for a known function
		doc = Positron.fetch_documentation(sum)
		@test doc !== nothing
		@test length(doc) > 0
		@test occursin("sum", doc)
	end

	@testset "Markdown to HTML" begin
		# Simple markdown
		html = Positron.markdown_to_html("# Header\n\nParagraph text.")
		@test occursin("<h1>", html) || occursin("Header", html)
		@test occursin("Paragraph", html)

		# Code block
		html = Positron.markdown_to_html("```julia\nx = 1\n```")
		@test occursin("x = 1", html)
	end

	@testset "Get help content" begin
		# Test getting help for a standard function
		content = Positron.get_help_content("sum")
		@test content !== nothing
		@test length(content) > 0

		# Test non-existent topic
		content = Positron.get_help_content("nonexistent_function_xyz_123")
		@test content === nothing
	end

	@testset "Request parsing" begin
		# Test show_help_topic request
		data = Dict("method" => "show_help_topic", "params" => Dict("topic" => "sum"))
		req = Positron.parse_help_request(data)
		@test req isa Positron.ShowHelpTopicRequest
		@test req.topic == "sum"

		# Test unknown method
		data = Dict("method" => "unknown_method", "params" => Dict())
		@test_throws ErrorException Positron.parse_help_request(data)
	end

	@testset "ShowHelpParams serialization" begin
		params = Positron.ShowHelpParams("<html>content</html>", "html", true)
		json_str = JSON3.write(params)
		parsed = JSON3.read(json_str)

		@test parsed["content"] == "<html>content</html>"
		@test parsed["kind"] == "html"
		@test parsed["focus"] == true
	end

	@testset "HelpService creation" begin
		service = Positron.HelpService()
		@test service.comm === nothing
	end
end
