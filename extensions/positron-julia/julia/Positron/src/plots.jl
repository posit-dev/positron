# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Plots service for Positron.

This module provides the Plots pane functionality, allowing Julia plots
to be displayed in Positron's plot viewer.
"""

using Base64

"""
Represents a rendered plot.
"""
mutable struct PlotData
	id::String
	data::Vector{UInt8}
	mime_type::String
	width::Int
	height::Int
	pixel_ratio::Float64
end

"""
The Plots service manages the Plots pane in Positron.
"""
mutable struct PlotsService
	comm::Union{PositronComm, Nothing}
	plots::Dict{String, Any}  # plot_id => plot object (for re-rendering)
	current_plot_id::Union{String, Nothing}
	render_settings::Dict{String, Any}

	function PlotsService()
		new(nothing, Dict{String, Any}(), nothing, Dict{String, Any}(
			"width" => 800,
			"height" => 600,
			"pixel_ratio" => 1.0
		))
	end
end

"""
Initialize the plots service with a comm.
"""
function init!(service::PlotsService, comm::PositronComm)
	service.comm = comm

	on_msg!(comm, msg -> handle_plots_msg(service, msg))
	on_close!(comm, () -> handle_plots_close(service))
end

"""
Handle incoming messages on the plots comm.
"""
function handle_plots_msg(service::PlotsService, msg::Dict)
	request = parse_plot_request(msg)

	if request isa PlotRenderParams
		handle_render(service, request)
	elseif request === nothing
		# get_intrinsic_size request
		handle_get_intrinsic_size(service)
	end
end

"""
Handle plots comm close.
"""
function handle_plots_close(service::PlotsService)
	service.comm = nothing
end

"""
Handle render request.
"""
function handle_render(service::PlotsService, request::PlotRenderParams)
	if service.current_plot_id === nothing
		send_error(service.comm, JsonRpcErrorCode.INVALID_PARAMS, "No current plot")
		return
	end

	plot_obj = get(service.plots, service.current_plot_id, nothing)
	if plot_obj === nothing
		send_error(service.comm, JsonRpcErrorCode.INVALID_PARAMS, "Plot not found")
		return
	end

	# Extract dimensions from request
	width = request.size !== nothing ? request.size.width : service.render_settings["width"]
	height = request.size !== nothing ? request.size.height : service.render_settings["height"]
	format_str = string(request.format)

	# Render the plot
	try
		data = render_plot(plot_obj, width, height, request.pixel_ratio, format_str)
		mime_type = get_mime_type(format_str)

		# Build settings to return
		settings = PlotRenderSettings(
			PlotSize(height, width),
			request.pixel_ratio,
			request.format
		)

		result = PlotResult(
			base64encode(data),
			mime_type,
			settings
		)
		send_result(service.comm, result)
	catch e
		@error "Failed to render plot" exception=(e, catch_backtrace())
		send_error(service.comm, JsonRpcErrorCode.INTERNAL_ERROR, "Failed to render plot: $(sprint(showerror, e))")
	end
end

"""
Handle get_intrinsic_size request.
"""
function handle_get_intrinsic_size(service::PlotsService)
	# Most Julia plots don't have intrinsic sizes, return nothing
	send_result(service.comm, nothing)
end

"""
Update render settings (called when plot pane is resized).
"""
function update_render_settings!(service::PlotsService, width::Int, height::Int, pixel_ratio::Float64)
	service.render_settings["width"] = width
	service.render_settings["height"] = height
	service.render_settings["pixel_ratio"] = pixel_ratio
end

"""
Render a plot object to bytes.
"""
function render_plot(plot_obj::Any, width::Int, height::Int, pixel_ratio::Float64, format::String)::Vector{UInt8}
	# Try to use the plot's native rendering
	io = IOBuffer()

	# Determine MIME type
	mime = get_mime_type(format)

	# Try to show the plot with the requested MIME type
	if showable(MIME(mime), plot_obj)
		show(io, MIME(mime), plot_obj)
	elseif showable(MIME("image/png"), plot_obj)
		show(io, MIME("image/png"), plot_obj)
	elseif showable(MIME("image/svg+xml"), plot_obj)
		show(io, MIME("image/svg+xml"), plot_obj)
	else
		error("Plot object does not support image rendering")
	end

	return take!(io)
end

"""
Get MIME type for a format string.
"""
function get_mime_type(format::String)::String
	format_lower = lowercase(format)
	if format_lower == "png"
		return "image/png"
	elseif format_lower == "svg"
		return "image/svg+xml"
	elseif format_lower == "pdf"
		return "application/pdf"
	elseif format_lower == "jpeg" || format_lower == "jpg"
		return "image/jpeg"
	else
		return "image/png"
	end
end

"""
Register a new plot and show it in the Plots pane.
"""
function show_plot!(service::PlotsService, plot_obj::Any; id::String=string(uuid4()))
	if service.comm === nothing
		return
	end

	# Store the plot object for later re-rendering
	service.plots[id] = plot_obj
	service.current_plot_id = id

	# Generate a pre-render for immediate display
	pre_render = try
		width = service.render_settings["width"]
		height = service.render_settings["height"]
		pixel_ratio = service.render_settings["pixel_ratio"]
		data = render_plot(plot_obj, width, height, pixel_ratio, "png")

		settings = PlotRenderSettings(
			PlotSize(height, width),
			pixel_ratio,
			PlotRenderFormat_Png
		)

		PlotResult(
			base64encode(data),
			"image/png",
			settings
		)
	catch e
		@debug "Failed to pre-render plot" exception=e
		nothing
	end

	# Notify frontend about updated plot
	params = PlotUpdateParams(pre_render)
	send_event(service.comm, "update", params)
end

"""
Remove a plot from the service.
"""
function remove_plot!(service::PlotsService, id::String)
	delete!(service.plots, id)
	if service.current_plot_id == id
		service.current_plot_id = nothing
	end
end

"""
Clear all plots.
"""
function clear_plots!(service::PlotsService)
	empty!(service.plots)
	service.current_plot_id = nothing
end

"""
Get current render settings (useful for plot backends).
"""
function get_render_settings(service::PlotsService)
	return (
		width = service.render_settings["width"],
		height = service.render_settings["height"],
		pixel_ratio = service.render_settings["pixel_ratio"]
	)
end

# -------------------------------------------------------------------------
# Plot Backend Integration
# -------------------------------------------------------------------------

"""
Abstract type for plot backends.
"""
abstract type PlotBackend end

"""
Check if a value is a displayable plot.
"""
function is_plot(value::Any)::Bool
	# Check common plot types
	type_name = string(typeof(value))

	# Plots.jl
	if occursin("Plot", type_name) && occursin("Plots", type_name)
		return true
	end

	# Makie
	if occursin("Figure", type_name) || occursin("Scene", type_name)
		return true
	end

	# UnicodePlots
	if occursin("UnicodePlots", type_name) && occursin("Plot", type_name)
		return true
	end

	# Generic check - can it render to PNG or SVG?
	if showable(MIME("image/png"), value) || showable(MIME("image/svg+xml"), value)
		return true
	end

	return false
end

"""
Display a value as a plot if possible.
Returns true if the value was displayed as a plot.
"""
function try_display_plot!(service::PlotsService, value::Any)::Bool
	if is_plot(value)
		show_plot!(service, value)
		return true
	end
	return false
end
