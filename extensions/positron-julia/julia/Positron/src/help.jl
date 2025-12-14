# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Help service for Positron.

This module provides the Help pane functionality, displaying documentation
for Julia functions, types, and modules.
"""

using Markdown

"""
The Help service manages the Help pane in Positron.
"""
mutable struct HelpService
    comm::Any  # PositronComm or test mock - using Any for testability

    function HelpService()
        new(nothing)
    end
end

"""
Initialize the help service with a comm.
"""
function init!(service::HelpService, comm::PositronComm)
    service.comm = comm

    on_msg!(comm, msg -> handle_help_msg(service, msg))
    on_close!(comm, () -> handle_help_close(service))
end

"""
Handle incoming messages on the help comm.
"""
function handle_help_msg(service::HelpService, msg::Dict)
    request = parse_help_request(msg)

    if request isa HelpShowHelpTopicParams
        handle_show_help_topic(service, request.topic)
    end
end

"""
Handle help comm close.
"""
function handle_help_close(service::HelpService)
    service.comm = nothing
end

"""
Handle show_help_topic request - look up documentation and show it in Help pane.
"""
function handle_show_help_topic(service::HelpService, topic::String)
    if service.comm === nothing
        return
    end

    # Get help content for the topic
    content = get_help_content(topic)

    if content === nothing
        send_error(
            service.comm,
            JsonRpcErrorCode.INVALID_PARAMS,
            "No documentation found for: $topic",
        )
        return
    end

    # Send success result first
    send_result(service.comm, true)

    # Then send the ShowHelp event to display in Help pane
    params = HelpShowHelpParams(content, ShowHelpKind_Html, true)
    send_event(service.comm, "show_help", params)
end

"""
Get help content for a topic.
"""
function get_help_content(topic::String)::Union{String,Nothing}
    # Try to resolve the symbol
    sym = resolve_symbol(topic)
    if sym === nothing
        return nothing
    end

    # Get documentation
    try
        doc = fetch_documentation(sym)
        if doc === nothing || isempty(doc)
            return nothing
        end

        # Convert to HTML
        return markdown_to_html(doc)
    catch e
        @debug "Failed to get help content" topic exception=e
        return nothing
    end
end

"""
Resolve a topic string to a Julia symbol.
"""
function resolve_symbol(topic::String)
    # Handle module-qualified names like "Base.sort"
    parts = split(topic, ".")

    try
        # Start from Main
        current = Main

        for (i, part) in enumerate(parts)
            sym = Symbol(part)

            if i == length(parts)
                # Final part - could be a function, type, or value
                if isdefined(current, sym)
                    return getfield(current, sym)
                end
            else
                # Intermediate part - should be a module
                if isdefined(current, sym)
                    val = getfield(current, sym)
                    if val isa Module
                        current = val
                    else
                        return nothing
                    end
                else
                    return nothing
                end
            end
        end
    catch
        return nothing
    end

    return nothing
end

"""
Fetch documentation for a symbol.
"""
function fetch_documentation(sym)::Union{String,Nothing}
    try
        # Use the @doc macro to get documentation
        doc = Base.Docs.doc(sym)

        if doc === nothing
            return nothing
        end

        # Convert to string
        io = IOBuffer()
        show(IOContext(io, :color => false), MIME("text/plain"), doc)
        return String(take!(io))
    catch e
        @debug "Failed to fetch documentation" sym exception=e
        return nothing
    end
end

"""
Convert Markdown to HTML.
"""
function markdown_to_html(md_str::String)::String
    try
        # Parse markdown
        md = Markdown.parse(md_str)

        # Convert to HTML
        io = IOBuffer()
        show(io, MIME("text/html"), md)
        return String(take!(io))
    catch e
        # Fall back to plain text wrapped in pre
        return "<pre>$(escape_html(md_str))</pre>"
    end
end

"""
Escape HTML special characters.
"""
function escape_html(s::String)::String
    s = replace(s, "&" => "&amp;")
    s = replace(s, "<" => "&lt;")
    s = replace(s, ">" => "&gt;")
    s = replace(s, "\"" => "&quot;")
    s = replace(s, "'" => "&#39;")
    return s
end

"""
Show help for a topic in the Help pane.
"""
function show_help!(service::HelpService, topic::String; focus::Bool = true)
    if service.comm === nothing
        return
    end

    content = get_help_content(topic)
    if content === nothing
        return
    end

    params = HelpShowHelpParams(content, ShowHelpKind_Html, focus)
    send_event(service.comm, "show_help", params)
end

"""
Show help for a URL.
"""
function show_help_url!(service::HelpService, url::String; focus::Bool = true)
    if service.comm === nothing
        return
    end

    params = HelpShowHelpParams(url, ShowHelpKind_Url, focus)
    send_event(service.comm, "show_help", params)
end
