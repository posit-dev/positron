# Tests for Plots service
using Test

# Import plot_comm types
import Positron:
    Plot,
    PlotsService,
    PositronDisplay,
    DISPLAYABLE_MIMES,
    get_mime_type,
    is_plot,
    create_render_func,
    sanitize_html_for_console

# Import comm types for testing
import Positron:
    PlotRenderParams,
    PlotSize,
    PlotRenderFormat_Png,
    PlotRenderFormat_Svg,
    parse_plot_request

@testset "Plots Service Tests" begin
    @testset "Service Initialization" begin
        service = PlotsService()
        @test service.display === nothing  # Display created on init!
        @test isempty(service.plots)
        @test service.enabled == true
    end

    @testset "MIME Type Mapping" begin
        @test get_mime_type("png") == "image/png"
        @test get_mime_type("PNG") == "image/png"
        @test get_mime_type("svg") == "image/svg+xml"
        @test get_mime_type("SVG") == "image/svg+xml"
        @test get_mime_type("pdf") == "application/pdf"
        @test get_mime_type("jpeg") == "image/jpeg"
        @test get_mime_type("jpg") == "image/jpeg"
        @test get_mime_type("tiff") == "image/tiff"
        @test get_mime_type("unknown") == "image/png"  # Default fallback
    end

    @testset "Displayable MIME Types" begin
        @test MIME("image/png") in DISPLAYABLE_MIMES
        @test MIME("image/svg+xml") in DISPLAYABLE_MIMES
        @test MIME("image/jpeg") in DISPLAYABLE_MIMES
        @test length(DISPLAYABLE_MIMES) == 3
    end

    @testset "is_plot Detection" begin
        # Basic types should not be plots
        @test is_plot(42) == false
        @test is_plot("string") == false
        @test is_plot([1, 2, 3]) == false
        @test is_plot(Dict("a" => 1)) == false
        @test is_plot(nothing) == false

        # Would need actual plot objects from Plots.jl/Makie to test true case
        # These would require installing the packages
    end

    @testset "Plot struct" begin
        # Create a simple render function that returns test data
        render_func = (size, pixel_ratio, format) -> begin
            Vector{UInt8}("test_image_data")
        end

        # Test default construction
        plot = Plot(render_func)
        @test !isempty(plot.id)
        @test plot.comm === nothing
        @test plot.intrinsic_size === nothing
        @test plot.closed == false
        @test plot.render_func !== nothing

        # Test with custom id
        plot2 = Plot(render_func; id = "custom-plot-id")
        @test plot2.id == "custom-plot-id"

        # Test with intrinsic size
        plot3 = Plot(render_func; intrinsic_size = (6.0, 4.0))
        @test plot3.intrinsic_size == (6.0, 4.0)

        # Test with all options
        plot4 = Plot(
            render_func;
            id = "full-options",
            intrinsic_size = (10.0, 8.0),
        )
        @test plot4.id == "full-options"
        @test plot4.intrinsic_size == (10.0, 8.0)
    end

    @testset "Plot render function" begin
        # Create a render function that tracks calls
        calls = []
        render_func = (size, pixel_ratio, format) -> begin
            push!(calls, (size, pixel_ratio, format))
            Vector{UInt8}("rendered_$format")
        end

        plot = Plot(render_func)

        # Call render function directly
        result = plot.render_func(nothing, 1.0, "png")
        @test result == Vector{UInt8}("rendered_png")
        @test length(calls) == 1
        @test calls[1] == (nothing, 1.0, "png")

        # Call with size
        size = PlotSize(600, 400)
        result2 = plot.render_func(size, 2.0, "svg")
        @test result2 == Vector{UInt8}("rendered_svg")
        @test length(calls) == 2
        @test calls[2] == (size, 2.0, "svg")
    end

    @testset "Request parsing" begin
        # Test render request
        render_msg = Dict(
            "method" => "render",
            "params" => Dict(
                "size" => Dict("width" => 800, "height" => 600),
                "pixel_ratio" => 2.0,
                "format" => "png",
            ),
        )
        request = parse_plot_request(render_msg)
        @test request isa PlotRenderParams
        @test request.pixel_ratio == 2.0

        # Test get_intrinsic_size request
        intrinsic_msg = Dict("method" => "get_intrinsic_size", "params" => Dict())
        request2 = parse_plot_request(intrinsic_msg)
        @test request2 === nothing  # Returns nothing for this method
    end

    @testset "PositronDisplay creation" begin
        service = PlotsService()
        display = PositronDisplay(service)

        @test display.service === service
        @test display isa AbstractDisplay
    end

    @testset "Service shutdown" begin
        service = PlotsService()
        service.enabled = true

        # Create some mock plots
        render_func = (size, pixel_ratio, format) -> Vector{UInt8}("test")
        push!(service.plots, Plot(render_func; id = "plot1"))
        push!(service.plots, Plot(render_func; id = "plot2"))

        @test length(service.plots) == 2
        @test service.enabled == true

        # Call shutdown
        Positron.shutdown!(service)

        @test isempty(service.plots)
        @test service.enabled == false
    end

    @testset "Plot close" begin
        render_func = (size, pixel_ratio, format) -> Vector{UInt8}("test")
        plot = Plot(render_func)

        @test plot.closed == false

        # Close the plot (without comm)
        Positron.close_plot!(plot)

        @test plot.closed == true
        @test plot.comm === nothing

        # Closing again should be safe
        Positron.close_plot!(plot)
        @test plot.closed == true
    end

    @testset "HTML Sanitization for Console" begin
        # Test stripping double-quoted style attributes
        html = """<div style="color: red;">Hello</div>"""
        result = sanitize_html_for_console(html)
        @test result == """<div>Hello</div>"""

        # Test stripping single-quoted style attributes
        html = """<div style='text-align: center;'>Hello</div>"""
        result = sanitize_html_for_console(html)
        @test result == """<div>Hello</div>"""

        # Test with multiple style attributes
        html = """<table style="border: 1px;"><tr style="color: blue;"><td>Data</td></tr></table>"""
        result = sanitize_html_for_console(html)
        @test result == """<table><tr><td>Data</td></tr></table>"""

        # Test HTML without style attributes (should be unchanged)
        html = """<div class="container"><span>Text</span></div>"""
        result = sanitize_html_for_console(html)
        @test result == html

        # Test complex DataFrames-like HTML
        html = """<table class="data-frame"><thead><tr><th style="text-align: right;">id</th></tr></thead><tbody><tr><td style="text-align: right;">1</td></tr></tbody></table>"""
        result = sanitize_html_for_console(html)
        @test !occursin("style=", result)
        @test occursin("class=\"data-frame\"", result)  # Other attributes preserved
    end
end

# TODO: Add integration tests with actual plotting packages:
# - Plots.jl integration
# - Makie.jl integration (CairoMakie, GLMakie)
# - UnicodePlots.jl (fallback display)
#
# These tests would require:
# 1. Installing the packages as test dependencies
# 2. Creating actual plots
# 3. Verifying display capture works
# 4. Verifying comm messages are correct
#
# Example structure for Plots.jl tests:
# @testset "Plots.jl Integration" begin
#     using Plots
#     service = PlotsService()
#     Positron.init!(service)
#
#     # Create a plot
#     p = plot([1, 2, 3], [4, 5, 6])
#     display(p)
#
#     # Verify plot was captured
#     @test length(service.plots) == 1
#     @test !isempty(service.plots[1].id)
# end
