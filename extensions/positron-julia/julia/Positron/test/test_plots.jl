# Tests for Plots service
using Test

@testset "Plots Service Tests" begin
	@testset "Service Initialization" begin
		service = Positron.PlotsService()
		@test service.comm === nothing
		@test isempty(service.plots)
		@test service.current_plot_id === nothing
		@test service.render_settings["width"] == 800
		@test service.render_settings["height"] == 600
	end

	@testset "MIME Type Mapping" begin
		@test Positron.get_mime_type("png") == "image/png"
		@test Positron.get_mime_type("svg") == "image/svg+xml"
		@test Positron.get_mime_type("pdf") == "application/pdf"
		@test Positron.get_mime_type("jpeg") == "image/jpeg"
		@test Positron.get_mime_type("jpg") == "image/jpeg"
		@test Positron.get_mime_type("unknown") == "image/png"  # Default
	end

	@testset "Render Settings Update" begin
		service = Positron.PlotsService()
		Positron.update_render_settings!(service, 1024, 768, 2.0)
		
		@test service.render_settings["width"] == 1024
		@test service.render_settings["height"] == 768
		@test service.render_settings["pixel_ratio"] == 2.0
	end

	@testset "is_plot Detection" begin
		# Test with various types
		@test Positron.is_plot(42) == false
		@test Positron.is_plot("string") == false
		@test Positron.is_plot([1, 2, 3]) == false
		
		# Would need actual plot objects from Plots.jl to test true case
		# TODO: Add when Plots.jl integration is complete
	end
end

# TODO: Add comprehensive tests once display system integration is complete:
# - Plot capture from Plots.jl
# - Plot capture from Makie.jl  
# - Automatic display in plot pane
# - Plot updates
# - Multiple plots
# - Plot format conversion (PNG, SVG)
