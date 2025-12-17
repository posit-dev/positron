# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Plots service for Positron.

This module provides the Plots pane functionality, allowing Julia plots
to be displayed in Positron's plot viewer.

The architecture follows the Python implementation:
1. PlotsService manages all Plot instances
2. Each plot has its own comm (opened from the kernel side)
3. PositronDisplay intercepts plots from Julia's display system
4. When a plot is captured, a new comm is opened to notify the frontend
"""

using Base64

# Supported MIME types for plots (in order of preference)
const DISPLAYABLE_MIMES = [
    MIME("image/png"),
    MIME("image/svg+xml"),
    MIME("image/jpeg"),
]

"""
A single plot instance with its associated comm.

Each plot has its own comm for handling render requests from the frontend.
"""
mutable struct Plot
    id::String
    comm::Union{PositronComm,Nothing}
    render_func::Function  # (size, pixel_ratio, format) -> bytes
    intrinsic_size::Union{Tuple{Float64,Float64},Nothing}
    closed::Bool

    function Plot(
        render_func::Function;
        id::String = string(uuid4()),
        intrinsic_size::Union{Tuple{Float64,Float64},Nothing} = nothing,
    )
        new(id, nothing, render_func, intrinsic_size, false)
    end
end

"""
The Plots service manages all Plot instances.

Automatically captures plots when they're displayed via Julia's display system
using PositronDisplay, similar to julia-vscode's InlineDisplay approach.
"""
mutable struct PlotsService
    plots::Vector{Plot}
    display::Any  # PositronDisplay or Nothing (can't forward-reference the type)
    enabled::Bool

    function PlotsService()
        new(Plot[], nothing, true)
    end
end

"""
Positron display backend for automatic plot capture.

Hooks into Julia's display system to automatically capture and display plots
in Positron's plot pane. Similar to julia-vscode's InlineDisplay.
"""
struct PositronDisplay <: AbstractDisplay
    service::PlotsService
end

"""
Display method for PositronDisplay - captures plots automatically.

Called by Julia's display system when a plot is shown with a specific MIME type.
"""
function Base.display(d::PositronDisplay, m::MIME, @nospecialize(x))
    if !d.service.enabled
        throw(MethodError(display, (d, m, x)))
    end

    # Check if this is a displayable MIME type
    mime_str = string(m)
    if startswith(mime_str, "image/") && showable(m, x)
        kernel_log_info("PositronDisplay: Capturing plot with MIME $mime_str")
        try
            capture_plot!(d.service, x)
            return  # Successfully captured
        catch e
            kernel_log_error("PositronDisplay: Failed to capture plot: $(sprint(showerror, e, catch_backtrace()))")
        end
    end

    # Fall through to next display in stack
    throw(MethodError(display, (d, m, x)))
end

"""
Check if a type looks like a plot (by type name heuristic).
"""
function looks_like_plot(@nospecialize(x))::Bool
    type_name = string(typeof(x))

    # Plots.jl
    if occursin("Plot", type_name) && occursin("Plots", type_name)
        return true
    end

    # Makie
    if occursin("Figure", type_name) || occursin("FigureAxisPlot", type_name)
        return true
    end
    if occursin("Scene", type_name) && occursin("Makie", type_name)
        return true
    end

    # UnicodePlots
    if occursin("UnicodePlots", type_name)
        return true
    end

    return false
end

"""
Display method for PositronDisplay - tries to find a suitable MIME type.

Called by Julia's display system when display(x) is called without a MIME type.
"""
function Base.display(d::PositronDisplay, @nospecialize(x))
    kernel_log_info("PositronDisplay.display called for type $(typeof(x)), enabled=$(d.service.enabled)")

    if !d.service.enabled
        kernel_log_info("PositronDisplay disabled, falling through")
        throw(MethodError(display, (d, x)))
    end

    # First check if it looks like a plot type by name
    is_plot_type = looks_like_plot(x)
    kernel_log_info("  looks_like_plot: $is_plot_type")

    # Try supported MIME types in order of preference
    for mime in DISPLAYABLE_MIMES
        is_showable = showable(mime, x)
        kernel_log_info("  Checking MIME $(string(mime)): showable=$is_showable")
        if is_showable
            kernel_log_info("PositronDisplay: Found displayable MIME $(string(mime)) for $(typeof(x))")
            return display(d, mime, x)
        end
    end

    # If it looks like a plot but nothing was showable, try to capture anyway
    if is_plot_type
        kernel_log_info("PositronDisplay: Plot type detected but no MIME showable, trying capture anyway")
        try
            capture_plot!(d.service, x)
            return
        catch e
            kernel_log_error("PositronDisplay: Failed to capture plot: $(sprint(showerror, e))")
        end
    end

    # Not a displayable plot - fall through to next display
    kernel_log_info("PositronDisplay: No displayable MIME found for $(typeof(x)), falling through")
    throw(MethodError(display, (d, x)))
end

"""
Initialize the plots service.

Sets up the PositronDisplay and hooks into IJulia's display_dict.
This should be called once when services start.
"""
function init!(service::PlotsService)
    kernel_log_info("Initializing PlotsService")

    # Create and install the display in the stack (for non-IJulia contexts)
    service.display = PositronDisplay(service)
    fix_displays!(service)

    # Hook into IJulia's display_dict for plot types
    # This is the key hook - IJulia uses display_dict for both explicit display()
    # and for automatic result display, bypassing the normal display stack
    install_ijulia_display_hook!(service)

    kernel_log_info("PlotsService initialized - display installed")
end

"""
Install a hook into IJulia.display_dict to intercept plot types.

IJulia bypasses the normal Julia display stack and uses display_dict directly.
We need to intercept this to capture plots for the Positron plots pane.
"""
function install_ijulia_display_hook!(service::PlotsService)
    if !isdefined(Main, :IJulia)
        kernel_log_warn("IJulia not loaded, skipping display_dict hook")
        return
    end

    kernel_log_info("Installing IJulia display_dict hook for plots")

    # Override Plots.jl's display_dict method if Plots.jl is loaded
    override_plots_display_dict!()

    # Override the generic display_dict for other plot types (Makie, etc.)
    override_generic_display_dict!()

    kernel_log_info("IJulia display hook installed")
end

# Track whether we've installed the Plots.jl override
const _plots_override_installed = Ref(false)

"""
Override Plots.jl's display_dict method to capture plots for Positron.

Plots.jl defines: IJulia.display_dict(plt::Plot) = _ijulia_display_dict(plt)
We need to replace this with our own method that captures the plot first.
"""
function override_plots_display_dict!()
    if _plots_override_installed[]
        return  # Already installed
    end

    if !isdefined(Main, :Plots) || !isdefined(Main.Plots, :Plot)
        kernel_log_info("Plots.jl not loaded, skipping Plots.jl display_dict override")
        return
    end

    kernel_log_info("Overriding display_dict for Plots.jl Plot type")

    # Get the Plot type from Plots.jl
    PlotType = Main.Plots.Plot

    # Define a new method that intercepts Plots.jl plots
    # We use invokelatest to call back into Positron to avoid world age issues
    # Capture the Positron module reference for use in the @eval block
    PositronModule = @__MODULE__

    @eval Main.IJulia begin
        function display_dict(plt::$PlotType)
            # Get the kernel and capture the plot
            try
                kernel = Base.invokelatest($PositronModule.get_kernel)
                if kernel !== nothing && kernel.plots.enabled
                    Base.invokelatest($PositronModule.kernel_log_info, "display_dict: Intercepting Plots.jl plot")
                    Base.invokelatest($PositronModule.capture_plot!, kernel.plots, plt)
                    # Return empty dict - plot will appear in Plots pane only
                    return Dict{String,Any}()
                end
            catch e
                Base.invokelatest($PositronModule.kernel_log_error, "display_dict: Failed to capture plot: $(sprint(showerror, e))")
            end

            # Fall back to original Plots.jl behavior using the extension
            ext = Base.get_extension(Main.Plots, :IJuliaExt)
            return ext._ijulia_display_dict(plt)
        end
    end

    _plots_override_installed[] = true
    kernel_log_info("display_dict override installed for Plots.Plot")
end

"""
Override the generic display_dict to capture non-Plots.jl plot types (Makie, etc.).

This catches anything that looks like a plot but doesn't have a specific method.
"""
function override_generic_display_dict!()
    # Check if we've already installed the override
    if isdefined(Main.IJulia, :_positron_original_display_dict)
        kernel_log_info("Generic display_dict override already installed")
        return
    end

    kernel_log_info("Installing generic display_dict override for other plot types")

    # Store reference to the original _display_dict
    original_dd = Main.IJulia._display_dict

    # Capture the Positron module reference for use in the @eval block
    PositronModule = @__MODULE__

    # Override the generic display_dict method
    @eval Main.IJulia begin
        # Store original for fallback (global, not const, to allow redefinition)
        global _positron_original_display_dict = $original_dd

        function display_dict(@nospecialize(x))
            # Check if this looks like a plot type (Makie, UnicodePlots, etc.)
            try
                kernel = Base.invokelatest($PositronModule.get_kernel)
                if kernel !== nothing && kernel.plots.enabled
                    is_plot_type = Base.invokelatest($PositronModule.looks_like_plot, x)
                    if is_plot_type
                        Base.invokelatest($PositronModule.kernel_log_info, "display_dict: Intercepting plot-like object of type $(typeof(x))")
                        Base.invokelatest($PositronModule.capture_plot!, kernel.plots, x)
                        # Return empty dict - plot will appear in Plots pane only
                        return Dict{String,Any}()
                    end
                end
            catch e
                Base.invokelatest($PositronModule.kernel_log_error, "display_dict: Error checking plot type: $(sprint(showerror, e))")
            end

            # Not a plot, use original
            return _positron_original_display_dict(x)
        end
    end

    kernel_log_info("Generic display_dict override installed")
end

"""
Ensure PositronDisplay is at the top of the display stack.

Similar to julia-vscode's fix_displays() - removes any stale PositronDisplay
instances and pushes a fresh one.
"""
function fix_displays!(service::PlotsService)
    if service.display === nothing
        return
    end

    # Log current display stack before modification
    kernel_log_info("Display stack before fix_displays!:")
    for (i, d) in enumerate(Base.Multimedia.displays)
        kernel_log_info("  [$i] $(typeof(d))")
    end

    # Remove any existing PositronDisplay instances
    for d in reverse(Base.Multimedia.displays)
        if d isa PositronDisplay
            popdisplay(d)
        end
    end

    # Push our display at the top
    pushdisplay(service.display)

    # Log display stack after modification
    kernel_log_info("Display stack after fix_displays!:")
    for (i, d) in enumerate(Base.Multimedia.displays)
        kernel_log_info("  [$i] $(typeof(d))")
    end

    kernel_log_info("PositronDisplay installed at top of display stack")
end

"""
Capture a plot object and create a new Plot instance with its own comm.

This is called when PositronDisplay intercepts a plot from the display system.
"""
function capture_plot!(service::PlotsService, plot_obj::Any)
    kernel_log_info("Capturing plot of type $(typeof(plot_obj))")

    # Create a render function that captures the plot object
    # This allows re-rendering at different sizes later
    render_func = create_render_func(plot_obj)

    # Create the plot instance
    plot = Plot(render_func)
    push!(service.plots, plot)

    kernel_log_info("Created plot with ID $(plot.id)")

    # Open a comm from the kernel to notify the frontend
    open_plot_comm!(plot)
end

"""
Create a render function for a plot object.

The render function captures the plot object and can render it to bytes
at any size/format requested by the frontend.
"""
function create_render_func(plot_obj::Any)
    function render(size::Union{PlotSize,Nothing}, pixel_ratio::Float64, format::String)
        io = IOBuffer()
        mime = get_mime_type(format)

        # Try to render with the requested MIME type
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
    return render
end

"""
Open a comm for a plot instance.

This sends a comm_open message to the frontend, which will create
a corresponding plot view in the Plots pane.
"""
function open_plot_comm!(plot::Plot)
    kernel_log_info("Opening comm for plot $(plot.id)")

    # Create the comm
    comm = create_comm("positron.plot"; comm_id = plot.id)
    plot.comm = comm

    # Set up message handlers
    on_msg!(comm, msg -> handle_plot_msg(plot, msg))
    on_close!(comm, () -> handle_plot_close(plot))

    # Open the comm (sends comm_open to frontend)
    open!(comm)

    kernel_log_info("Plot comm opened: $(plot.id)")
end

"""
Handle incoming messages on a plot's comm.
"""
function handle_plot_msg(plot::Plot, msg::Dict)
    request = parse_plot_request(msg)

    if request isa PlotRenderParams
        handle_render(plot, request)
    elseif request === nothing
        # get_intrinsic_size request
        handle_get_intrinsic_size(plot)
    end
end

"""
Handle plot comm close.
"""
function handle_plot_close(plot::Plot)
    plot.closed = true
    plot.comm = nothing
end

"""
Handle render request for a specific plot.
"""
function handle_render(plot::Plot, request::PlotRenderParams)
    if plot.comm === nothing
        return
    end

    kernel_log_info("Rendering plot $(plot.id)")

    try
        # Extract format string
        format_str = string(request.format)

        # Render the plot
        data = plot.render_func(request.size, request.pixel_ratio, format_str)
        mime_type = get_mime_type(format_str)

        # Build result
        result = PlotResult(base64encode(data), mime_type, nothing)
        send_result(plot.comm, result)

        kernel_log_info("Plot $(plot.id) rendered successfully")
    catch e
        kernel_log_error("Failed to render plot $(plot.id): $(sprint(showerror, e, catch_backtrace()))")
        send_error(
            plot.comm,
            JsonRpcErrorCode.INTERNAL_ERROR,
            "Failed to render plot: $(sprint(showerror, e))",
        )
    end
end

"""
Handle get_intrinsic_size request for a specific plot.
"""
function handle_get_intrinsic_size(plot::Plot)
    if plot.comm === nothing
        return
    end

    if plot.intrinsic_size !== nothing
        width, height = plot.intrinsic_size
        result = IntrinsicSize(width, height, PlotUnit_Inches, "Julia")
        send_result(plot.comm, result)
    else
        # Most Julia plots don't have intrinsic sizes
        send_result(plot.comm, nothing)
    end
end

"""
Show a plot (re-open comm if closed).
"""
function show_plot!(plot::Plot)
    if plot.closed
        # Re-open the comm
        open_plot_comm!(plot)
        plot.closed = false
    elseif plot.comm !== nothing
        # Send show event
        send_event(plot.comm, "show", Dict())
    end
end

"""
Update a plot (notify frontend to re-render).
"""
function update_plot!(plot::Plot)
    if plot.closed
        # Re-open the comm
        open_plot_comm!(plot)
        plot.closed = false
    elseif plot.comm !== nothing
        # Send update event
        send_event(plot.comm, "update", PlotUpdateParams(nothing))
    end
end

"""
Close a plot.
"""
function close_plot!(plot::Plot)
    if !plot.closed && plot.comm !== nothing
        close!(plot.comm)
    end
    plot.closed = true
    plot.comm = nothing
end

"""
Shutdown the plots service.
"""
function shutdown!(service::PlotsService)
    kernel_log_info("Shutting down PlotsService")

    # Close all plot comms
    for plot in service.plots
        close_plot!(plot)
    end
    empty!(service.plots)

    # Disable the display
    service.enabled = false

    kernel_log_info("PlotsService shutdown complete")
end

# -------------------------------------------------------------------------
# Utility Functions
# -------------------------------------------------------------------------

"""
Get MIME type string for a format string.
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
    elseif format_lower == "tiff"
        return "image/tiff"
    else
        return "image/png"
    end
end

"""
Check if a value is a displayable plot.
"""
function is_plot(value::Any)::Bool
    for mime in DISPLAYABLE_MIMES
        if showable(mime, value)
            return true
        end
    end
    return false
end
