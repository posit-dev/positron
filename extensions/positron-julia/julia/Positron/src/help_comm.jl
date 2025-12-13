# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

#
# AUTO-GENERATED from help.json; do not edit.
#

"""
Possible values for Kind in ShowHelp
"""
@enum ShowHelpKind begin
    ShowHelpKind_Html
    ShowHelpKind_Markdown
    ShowHelpKind_Url
end

const SHOWHELPKIND_MAP = Dict(
    ShowHelpKind_Html => "html",
    ShowHelpKind_Markdown => "markdown",
    ShowHelpKind_Url => "url",
)

const STRING_TO_SHOWHELPKIND = Dict(v => k for (k, v) in SHOWHELPKIND_MAP)

StructTypes.StructType(::Type{ShowHelpKind}) = StructTypes.StringType()
StructTypes.construct(::Type{ShowHelpKind}, s::String) = STRING_TO_SHOWHELPKIND[s]
Base.string(x::ShowHelpKind) = SHOWHELPKIND_MAP[x]

"""
Requests that the help backend look for a help topic and, if found,
show it. If the topic is found, it will be shown via a Show Help
notification. If the topic is not found, no notification will be
delivered.
"""
struct ShowHelpTopicParams
    topic::String
end

StructTypes.StructType(::Type{ShowHelpTopicParams}) = StructTypes.Struct()

"""
Event: Request to show help in the frontend
"""
struct ShowHelpParams
    content::String
    kind::ShowHelpKind
    focus::Bool
end

StructTypes.StructType(::Type{ShowHelpParams}) = StructTypes.Struct()

"""
Parse a backend request for the Help comm.
"""
function parse_help_request(data::Dict)
    method = get(data, "method", nothing)
    params = get(data, "params", Dict())

    if method == "show_help_topic"
        return ShowHelpTopicParams(get(params, "topic", ""))
    else
        error("Unknown help method: $method")
    end
end
