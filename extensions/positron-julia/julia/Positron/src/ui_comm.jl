# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

#
# AUTO-GENERATED from ui.json; do not edit.
#

# External references
# From plot_comm.jl: PlotRenderSettings

# Param is represented as Any (Dict{String, Any})
const Param = Dict{String,Any}

# CallMethodResult is represented as Any (Dict{String, Any})
const CallMethodResult = Dict{String,Any}

"""
Possible values for Kind in OpenEditor
"""
@enum OpenEditorKind begin
    OpenEditorKind_Path
    OpenEditorKind_Uri
end

const OPENEDITORKIND_MAP = Dict(OpenEditorKind_Path => "path", OpenEditorKind_Uri => "uri")

const STRING_TO_OPENEDITORKIND = Dict(v => k for (k, v) in OPENEDITORKIND_MAP)

StructTypes.StructType(::Type{OpenEditorKind}) = StructTypes.StringType()
StructTypes.construct(::Type{OpenEditorKind}, s::String) = STRING_TO_OPENEDITORKIND[s]
Base.string(x::OpenEditorKind) = OPENEDITORKIND_MAP[x]

"""
Possible values for Type in PreviewSource
"""
@enum PreviewSourceType begin
    PreviewSourceType_Runtime
    PreviewSourceType_Terminal
end

const PREVIEWSOURCETYPE_MAP =
    Dict(PreviewSourceType_Runtime => "runtime", PreviewSourceType_Terminal => "terminal")

const STRING_TO_PREVIEWSOURCETYPE = Dict(v => k for (k, v) in PREVIEWSOURCETYPE_MAP)

StructTypes.StructType(::Type{PreviewSourceType}) = StructTypes.StringType()
StructTypes.construct(::Type{PreviewSourceType}, s::String) = STRING_TO_PREVIEWSOURCETYPE[s]
Base.string(x::PreviewSourceType) = PREVIEWSOURCETYPE_MAP[x]

"""
Document metadata
"""
struct TextDocument
    path::String
    eol::String
    is_closed::Bool
    is_dirty::Bool
    is_untitled::Bool
    language_id::String
    line_count::Int64
    version::Int64
end

StructTypes.StructType(::Type{TextDocument}) = StructTypes.Struct()

"""
A line and character position, such as the position of the cursor.
"""
struct Position
    character::Int64
    line::Int64
end

StructTypes.StructType(::Type{Position}) = StructTypes.Struct()

"""
Selection metadata
"""
struct Selection
    active::Position
    start::Position
    end_::Position
    text::String
end

StructTypes.StructType(::Type{Selection}) = StructTypes.Struct()
StructTypes.names(::Type{Selection}) = ((:end_, :end),)

"""
Editor metadata
"""
struct EditorContext
    document::TextDocument
    contents::Vector{String}
    selection::Selection
    selections::Vector{Selection}
end

StructTypes.StructType(::Type{EditorContext}) = StructTypes.Struct()

"""
Selection range
"""
struct Range
    start::Position
    end_::Position
end

StructTypes.StructType(::Type{Range}) = StructTypes.Struct()
StructTypes.names(::Type{Range}) = ((:end_, :end),)

"""
Source information for preview content
"""
struct PreviewSource
    type_::PreviewSourceType
    id::String
end

StructTypes.StructType(::Type{PreviewSource}) = StructTypes.Struct()
StructTypes.names(::Type{PreviewSource}) = ((:type_, :type),)

"""
Typically fired when the plot component has been resized by the user.
This notification is useful to produce accurate pre-renderings of
plots.
"""
struct UiDidChangePlotsRenderSettingsParams
    settings::PlotRenderSettings
end

StructTypes.StructType(::Type{UiDidChangePlotsRenderSettingsParams}) = StructTypes.Struct()

"""
Unlike other RPC methods, `call_method` calls into methods implemented
in the interpreter and returns the result back to the frontend using
an implementation-defined serialization scheme.
"""
struct UiCallMethodParams
    method::String
    params::Vector{Param}
end

StructTypes.StructType(::Type{UiCallMethodParams}) = StructTypes.Struct()

"""
Event: Change in backend's busy/idle status
"""
struct UiBusyParams
    busy::Bool
end

StructTypes.StructType(::Type{UiBusyParams}) = StructTypes.Struct()

"""
Event: Open an editor
"""
struct UiOpenEditorParams
    file::String
    line::Int64
    column::Int64
    kind::Union{OpenEditorKind,Nothing}
end

StructTypes.StructType(::Type{UiOpenEditorParams}) = StructTypes.Struct()

"""
Event: Show a message
"""
struct UiShowMessageParams
    message::String
end

StructTypes.StructType(::Type{UiShowMessageParams}) = StructTypes.Struct()

"""
Event: New state of the primary and secondary prompts
"""
struct UiPromptStateParams
    input_prompt::String
    continuation_prompt::String
end

StructTypes.StructType(::Type{UiPromptStateParams}) = StructTypes.Struct()

"""
Event: Change the displayed working directory
"""
struct UiWorkingDirectoryParams
    directory::String
end

StructTypes.StructType(::Type{UiWorkingDirectoryParams}) = StructTypes.Struct()

"""
Event: Open a workspace
"""
struct UiOpenWorkspaceParams
    path::String
    new_window::Bool
end

StructTypes.StructType(::Type{UiOpenWorkspaceParams}) = StructTypes.Struct()

"""
Event: Set the selections in the editor
"""
struct UiSetEditorSelectionsParams
    selections::Vector{Range}
end

StructTypes.StructType(::Type{UiSetEditorSelectionsParams}) = StructTypes.Struct()

"""
Event: Show a URL in Positron's Viewer pane
"""
struct UiShowUrlParams
    url::String
    source::Union{PreviewSource,Nothing}
end

StructTypes.StructType(::Type{UiShowUrlParams}) = StructTypes.Struct()

"""
Event: Show an HTML file in Positron
"""
struct UiShowHtmlFileParams
    path::String
    title::String
    is_plot::Bool
    height::Int64
end

StructTypes.StructType(::Type{UiShowHtmlFileParams}) = StructTypes.Struct()

"""
Event: Open a file or folder with the system default application
"""
struct UiOpenWithSystemParams
    path::String
end

StructTypes.StructType(::Type{UiOpenWithSystemParams}) = StructTypes.Struct()

"""
Parse a backend request for the Ui comm.
"""
function parse_ui_request(data::Dict)
    method = get(data, "method", nothing)
    params = get(data, "params", Dict())

    if method == "did_change_plots_render_settings"
        return UiDidChangePlotsRenderSettingsParams(get(params, "settings", Dict()))
    elseif method == "call_method"
        return UiCallMethodParams(get(params, "method", ""), get(params, "params", []))
    else
        error("Unknown ui method: $method")
    end
end
