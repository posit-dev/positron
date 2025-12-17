# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
UI service for Positron.

This module provides UI-related functionality like handling plot render settings
and calling methods in the interpreter.
"""

"""
The UI service handles general UI-related communication with Positron.
"""
mutable struct UIService
    comm::Union{PositronComm,Nothing}
    plot_render_settings::PlotRenderSettings

    function UIService()
        # Default plot render settings
        default_size = PlotSize(600, 800)
        new(nothing, PlotRenderSettings(default_size, 1.0, PlotRenderFormat_Png))
    end
end

"""
Initialize the UI service with a comm.
"""
function init!(service::UIService, comm::PositronComm)
    service.comm = comm

    on_msg!(comm, msg -> handle_ui_msg(service, msg))
    on_close!(comm, () -> handle_ui_close(service))
end

"""
Handle incoming messages on the UI comm.
"""
function handle_ui_msg(service::UIService, msg::Dict)
    method = get(msg, "method", "unknown")
    kernel_log_info("UI service received message: method=$method")

    request = parse_ui_request(msg)
    kernel_log_info("UI service parsed request: $(typeof(request))")

    if request isa UiDidChangePlotsRenderSettingsParams
        kernel_log_info("UI service handling did_change_plots_render_settings")
        handle_did_change_plots_render_settings(service, request)
    elseif request isa UiCallMethodParams
        kernel_log_info("UI service handling call_method: $(request.method)")
        handle_call_method(service, request)
    else
        kernel_log_warn("UI service: unknown request type: $(typeof(request))")
    end
end

"""
Handle UI comm close.
"""
function handle_ui_close(service::UIService)
    service.comm = nothing
end

"""
Handle did_change_plots_render_settings notification.
"""
function handle_did_change_plots_render_settings(
    service::UIService,
    request::UiDidChangePlotsRenderSettingsParams,
)
    kernel_log_info("Updating plot render settings: size=$(request.settings.size), pixel_ratio=$(request.settings.pixel_ratio), format=$(request.settings.format)")
    service.plot_render_settings = request.settings
    kernel_log_info("Sending result for did_change_plots_render_settings")
    send_result(service.comm, nothing)
    kernel_log_info("Result sent for did_change_plots_render_settings")
end

"""
Handle call_method request.
"""
function handle_call_method(service::UIService, request::UiCallMethodParams)
    # Execute the method in the interpreter
    try
        result = call_interpreter_method(request.method, request.params)
        send_result(service.comm, result)
    catch e
        kernel_log_error("Failed to call method $(request.method): $(sprint(showerror, e, catch_backtrace()))")
        send_error(
            service.comm,
            JsonRpcErrorCode.INTERNAL_ERROR,
            "Method call failed: $(sprint(showerror, e))",
        )
    end
end

"""
Call a method in the interpreter.
"""
function call_interpreter_method(method::String, params::Vector)::Any
    # Map method names to implementations
    if method == "getVariables"
        return get_variables_for_ui()
    elseif method == "evaluateExpression"
        if length(params) >= 1
            expr_str = string(params[1])
            return evaluate_expression(expr_str)
        end
        error("Missing expression parameter")
    else
        error("Unknown method: $method")
    end
end

"""
Get variables for UI display.
"""
function get_variables_for_ui()::Dict
    variables = Dict{String,Any}()

    for name in names(Main; all = false)
        name_str = string(name)

        # Skip internal names
        if startswith(name_str, "#") || startswith(name_str, "_")
            continue
        end
        if name in (:Base, :Core, :Main, :ans, :include, :eval)
            continue
        end

        try
            val = getfield(Main, name)
            if !(val isa Module)
                variables[name_str] = Dict(
                    "type" => string(typeof(val)),
                    "value" => repr(val; context = :limit => true),
                )
            end
        catch
        end
    end

    return variables
end

"""
Evaluate an expression and return the result.
"""
function evaluate_expression(expr_str::String)::Any
    try
        expr = Meta.parse(expr_str)
        result = Core.eval(Main, expr)
        return Dict(
            "success" => true,
            "result" => repr(result; context = :limit => true),
            "type" => string(typeof(result)),
        )
    catch e
        return Dict("success" => false, "error" => sprint(showerror, e))
    end
end

"""
Get the current plot render settings.
"""
function get_plot_render_settings(service::UIService)::PlotRenderSettings
    return service.plot_render_settings
end

"""
Show a message notification to the user in the Positron UI.

This displays a toast notification in the bottom right corner of the IDE.
"""
function show_message!(service::UIService, message::String)
    if service.comm === nothing
        kernel_log_warn("UI comm not initialized, cannot show message: $message")
        return
    end

    params = UiShowMessageParams(message)
    send_event(service.comm, "show_message", params)
    kernel_log_info("Sent UI notification: $message")
end
