# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

#
# AUTO-GENERATED from plot.json; do not edit.
#

"""
Possible values for PlotUnit
"""
@enum PlotUnit begin
    PlotUnit_Pixels
    PlotUnit_Inches
end

const PLOTUNIT_MAP = Dict(PlotUnit_Pixels => "pixels", PlotUnit_Inches => "inches")

const STRING_TO_PLOTUNIT = Dict(v => k for (k, v) in PLOTUNIT_MAP)

StructTypes.StructType(::Type{PlotUnit}) = StructTypes.StringType()
StructTypes.construct(::Type{PlotUnit}, s::String) = STRING_TO_PLOTUNIT[s]
Base.string(x::PlotUnit) = PLOTUNIT_MAP[x]

"""
Possible values for PlotRenderFormat
"""
@enum PlotRenderFormat begin
    PlotRenderFormat_Png
    PlotRenderFormat_Jpeg
    PlotRenderFormat_Svg
    PlotRenderFormat_Pdf
    PlotRenderFormat_Tiff
end

const PLOTRENDERFORMAT_MAP = Dict(
    PlotRenderFormat_Png => "png",
    PlotRenderFormat_Jpeg => "jpeg",
    PlotRenderFormat_Svg => "svg",
    PlotRenderFormat_Pdf => "pdf",
    PlotRenderFormat_Tiff => "tiff",
)

const STRING_TO_PLOTRENDERFORMAT = Dict(v => k for (k, v) in PLOTRENDERFORMAT_MAP)

StructTypes.StructType(::Type{PlotRenderFormat}) = StructTypes.StringType()
StructTypes.construct(::Type{PlotRenderFormat}, s::String) = STRING_TO_PLOTRENDERFORMAT[s]
Base.string(x::PlotRenderFormat) = PLOTRENDERFORMAT_MAP[x]

"""
The intrinsic size of a plot, if known
"""
struct IntrinsicSize
    width::Float64
    height::Float64
    unit::PlotUnit
    source::String
end

StructTypes.StructType(::Type{IntrinsicSize}) = StructTypes.Struct()

"""
The size of a plot
"""
struct PlotSize
    height::Int64
    width::Int64
end

StructTypes.StructType(::Type{PlotSize}) = StructTypes.Struct()

"""
The settings used to render the plot
"""
struct PlotRenderSettings
    size::PlotSize
    pixel_ratio::Float64
    format::PlotRenderFormat
end

StructTypes.StructType(::Type{PlotRenderSettings}) = StructTypes.Struct()

"""
A rendered plot
"""
struct PlotResult
    data::String
    mime_type::String
    settings::Union{PlotRenderSettings,Nothing}
end

StructTypes.StructType(::Type{PlotResult}) = StructTypes.Struct()

"""
Requests a plot to be rendered. The plot data is returned in a
base64-encoded string.
"""
struct PlotRenderParams
    size::Union{PlotSize,Nothing}
    pixel_ratio::Float64
    format::PlotRenderFormat
end

StructTypes.StructType(::Type{PlotRenderParams}) = StructTypes.Struct()

"""
Event: Notification that a plot has been updated on the backend.
"""
struct PlotUpdateParams
    pre_render::Union{PlotResult,Nothing}
end

StructTypes.StructType(::Type{PlotUpdateParams}) = StructTypes.Struct()

"""
Parse a backend request for the Plot comm.
"""
function parse_plot_request(data::Dict)
    method = get(data, "method", nothing)
    params = get(data, "params", Dict())

    if method == "get_intrinsic_size"
        return nothing
    elseif method == "render"
        # Parse size (optional)
        size_data = get(params, "size", nothing)
        size = if size_data !== nothing && size_data isa Dict
            PlotSize(
                get(size_data, "height", 0),
                get(size_data, "width", 0),
            )
        else
            nothing
        end

        # Parse pixel_ratio
        pixel_ratio = get(params, "pixel_ratio", 1.0)

        # Parse format (string to enum)
        format_str = get(params, "format", "png")
        format = get(STRING_TO_PLOTRENDERFORMAT, lowercase(format_str), PlotRenderFormat_Png)

        return PlotRenderParams(size, pixel_ratio, format)
    else
        error("Unknown plot method: $method")
    end
end
