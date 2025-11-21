#
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

#
# AUTO-GENERATED from ui.json; do not edit.
#

# flake8: noqa

# For forward declarations
from __future__ import annotations

import enum
from typing import Any, List, Literal, Optional, Union

from ._vendor.pydantic import BaseModel, Field, StrictBool, StrictFloat, StrictInt, StrictStr

from .plot_comm import PlotRenderSettings

Param = Any
CallMethodResult = Any


@enum.unique
class OpenEditorKind(str, enum.Enum):
    """
    Possible values for Kind in OpenEditor
    """

    Path = "path"

    Uri = "uri"


@enum.unique
class PreviewSourceType(str, enum.Enum):
    """
    Possible values for Type in PreviewSource
    """

    Runtime = "runtime"

    Terminal = "terminal"


class EditorContext(BaseModel):
    """
    Editor metadata
    """

    document: TextDocument = Field(
        description="Document metadata",
    )

    contents: List[StrictStr] = Field(
        description="Document contents",
    )

    selection: Selection = Field(
        description="The primary selection, i.e. selections[0]",
    )

    selections: List[Selection] = Field(
        description="The selections in this text editor.",
    )


class TextDocument(BaseModel):
    """
    Document metadata
    """

    path: StrictStr = Field(
        description="URI of the resource viewed in the editor",
    )

    eol: StrictStr = Field(
        description="End of line sequence",
    )

    is_closed: StrictBool = Field(
        description="Whether the document has been closed",
    )

    is_dirty: StrictBool = Field(
        description="Whether the document has been modified",
    )

    is_untitled: StrictBool = Field(
        description="Whether the document is untitled",
    )

    language_id: StrictStr = Field(
        description="Language identifier",
    )

    line_count: StrictInt = Field(
        description="Number of lines in the document",
    )

    version: StrictInt = Field(
        description="Version number of the document",
    )


class Position(BaseModel):
    """
    A line and character position, such as the position of the cursor.
    """

    character: StrictInt = Field(
        description="The zero-based character value, as a Unicode code point offset.",
    )

    line: StrictInt = Field(
        description="The zero-based line value.",
    )


class Selection(BaseModel):
    """
    Selection metadata
    """

    active: Position = Field(
        description="Position of the cursor.",
    )

    start: Position = Field(
        description="Start position of the selection",
    )

    end: Position = Field(
        description="End position of the selection",
    )

    text: StrictStr = Field(
        description="Text of the selection",
    )


class Range(BaseModel):
    """
    Selection range
    """

    start: Position = Field(
        description="Start position of the selection",
    )

    end: Position = Field(
        description="End position of the selection",
    )


class PreviewSource(BaseModel):
    """
    Source information for preview content
    """

    type: PreviewSourceType = Field(
        description="The type of source that opened the preview",
    )

    id: StrictStr = Field(
        description="The ID of the source (session_id or terminal process ID)",
    )


@enum.unique
class UiBackendRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the backend ui comm.
    """

    # Notification that the settings to render a plot (i.e. the plot size)
    # have changed.
    DidChangePlotsRenderSettings = "did_change_plots_render_settings"

    # Run a method in the interpreter and return the result to the frontend
    CallMethod = "call_method"


class DidChangePlotsRenderSettingsParams(BaseModel):
    """
    Typically fired when the plot component has been resized by the user.
    This notification is useful to produce accurate pre-renderings of
    plots.
    """

    settings: PlotRenderSettings = Field(
        description="Plot rendering settings.",
    )


class DidChangePlotsRenderSettingsRequest(BaseModel):
    """
    Typically fired when the plot component has been resized by the user.
    This notification is useful to produce accurate pre-renderings of
    plots.
    """

    params: DidChangePlotsRenderSettingsParams = Field(
        description="Parameters to the DidChangePlotsRenderSettings method",
    )

    method: Literal[UiBackendRequest.DidChangePlotsRenderSettings] = Field(
        description="The JSON-RPC method name (did_change_plots_render_settings)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class CallMethodParams(BaseModel):
    """
    Unlike other RPC methods, `call_method` calls into methods implemented
    in the interpreter and returns the result back to the frontend using
    an implementation-defined serialization scheme.
    """

    method: StrictStr = Field(
        description="The method to call inside the interpreter",
    )

    params: List[Param] = Field(
        description="The parameters for `method`",
    )


class CallMethodRequest(BaseModel):
    """
    Unlike other RPC methods, `call_method` calls into methods implemented
    in the interpreter and returns the result back to the frontend using
    an implementation-defined serialization scheme.
    """

    params: CallMethodParams = Field(
        description="Parameters to the CallMethod method",
    )

    method: Literal[UiBackendRequest.CallMethod] = Field(
        description="The JSON-RPC method name (call_method)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class UiBackendMessageContent(BaseModel):
    comm_id: str
    data: Union[
        DidChangePlotsRenderSettingsRequest,
        CallMethodRequest,
    ] = Field(..., discriminator="method")


@enum.unique
class UiFrontendEvent(str, enum.Enum):
    """
    An enumeration of all the possible events that can be sent to the frontend ui comm.
    """

    # Change in backend's busy/idle status
    Busy = "busy"

    # Clear the console
    ClearConsole = "clear_console"

    # Open an editor
    OpenEditor = "open_editor"

    # Show a message
    ShowMessage = "show_message"

    # New state of the primary and secondary prompts
    PromptState = "prompt_state"

    # Change the displayed working directory
    WorkingDirectory = "working_directory"

    # Open a workspace
    OpenWorkspace = "open_workspace"

    # Set the selections in the editor
    SetEditorSelections = "set_editor_selections"

    # Show a URL in Positron's Viewer pane
    ShowUrl = "show_url"

    # Show an HTML file in Positron
    ShowHtmlFile = "show_html_file"

    # Open a file or folder with the system default application
    OpenWithSystem = "open_with_system"

    # Webview preloads should be flushed
    ClearWebviewPreloads = "clear_webview_preloads"


class BusyParams(BaseModel):
    """
    Change in backend's busy/idle status
    """

    busy: StrictBool = Field(
        description="Whether the backend is busy",
    )


class OpenEditorParams(BaseModel):
    """
    Open an editor
    """

    file: StrictStr = Field(
        description="The path of the file to open",
    )

    line: StrictInt = Field(
        description="The line number to jump to",
    )

    column: StrictInt = Field(
        description="The column number to jump to",
    )

    kind: Optional[OpenEditorKind] = Field(
        description="How to interpret the 'file' argument: as a file path or as a URI. If omitted, defaults to 'path'.",
    )


class NewDocumentParams(BaseModel):
    """
    Create a new document with text contents
    """

    contents: StrictStr = Field(
        description="Document contents",
    )

    language_id: StrictStr = Field(
        description="Language identifier",
    )


class ShowMessageParams(BaseModel):
    """
    Show a message
    """

    message: StrictStr = Field(
        description="The message to show to the user.",
    )


class ShowQuestionParams(BaseModel):
    """
    Show a question
    """

    title: StrictStr = Field(
        description="The title of the dialog",
    )

    message: StrictStr = Field(
        description="The message to display in the dialog",
    )

    ok_button_title: StrictStr = Field(
        description="The title of the OK button",
    )

    cancel_button_title: StrictStr = Field(
        description="The title of the Cancel button",
    )


class ShowDialogParams(BaseModel):
    """
    Show a dialog
    """

    title: StrictStr = Field(
        description="The title of the dialog",
    )

    message: StrictStr = Field(
        description="The message to display in the dialog",
    )


class ShowPromptParams(BaseModel):
    """
    Show a prompt
    """

    title: StrictStr = Field(
        description="The title of the prompt dialog, such as 'Enter Swallow Velocity'",
    )

    message: StrictStr = Field(
        description="The message prompting the user for text, such as 'What is the airspeed velocity of an unladen swallow?'",
    )

    default: StrictStr = Field(
        description="The default value with which to pre-populate the text input box, such as 'African or European?'",
    )

    timeout: StrictInt = Field(
        description="The number of seconds to wait for the user to reply before giving up.",
    )


class AskForPasswordParams(BaseModel):
    """
    Ask the user for a password
    """

    prompt: StrictStr = Field(
        description="The prompt, such as 'Please enter your password'",
    )


class PromptStateParams(BaseModel):
    """
    New state of the primary and secondary prompts
    """

    input_prompt: StrictStr = Field(
        description="Prompt for primary input.",
    )

    continuation_prompt: StrictStr = Field(
        description="Prompt for incomplete input.",
    )


class WorkingDirectoryParams(BaseModel):
    """
    Change the displayed working directory
    """

    directory: StrictStr = Field(
        description="The new working directory",
    )


class DebugSleepParams(BaseModel):
    """
    Sleep for n seconds
    """

    ms: Union[StrictInt, StrictFloat] = Field(
        description="Duration in milliseconds",
    )


class ExecuteCommandParams(BaseModel):
    """
    Execute a Positron command
    """

    command: StrictStr = Field(
        description="The command to execute",
    )


class EvaluateWhenClauseParams(BaseModel):
    """
    Get a logical for a `when` clause (a set of context keys)
    """

    when_clause: StrictStr = Field(
        description="The values for context keys, as a `when` clause",
    )


class ExecuteCodeParams(BaseModel):
    """
    Execute code in a Positron runtime
    """

    language_id: StrictStr = Field(
        description="The language ID of the code to execute",
    )

    code: StrictStr = Field(
        description="The code to execute",
    )

    focus: StrictBool = Field(
        description="Whether to focus the runtime's console",
    )

    allow_incomplete: StrictBool = Field(
        description="Whether to bypass runtime code completeness checks",
    )


class OpenWorkspaceParams(BaseModel):
    """
    Open a workspace
    """

    path: StrictStr = Field(
        description="The path for the workspace to be opened",
    )

    new_window: StrictBool = Field(
        description="Should the workspace be opened in a new window?",
    )


class SetEditorSelectionsParams(BaseModel):
    """
    Set the selections in the editor
    """

    selections: List[Range] = Field(
        description="The selections (really, ranges) to set in the document",
    )


class ModifyEditorSelectionsParams(BaseModel):
    """
    Modify selections in the editor with a text edit
    """

    selections: List[Range] = Field(
        description="The selections (really, ranges) to set in the document",
    )

    values: List[StrictStr] = Field(
        description="The text values to insert at the selections",
    )


class ShowUrlParams(BaseModel):
    """
    Show a URL in Positron's Viewer pane
    """

    url: StrictStr = Field(
        description="The URL to display",
    )

    source: Optional[PreviewSource] = Field(
        description="Optional source information for the URL",
    )


class ShowHtmlFileParams(BaseModel):
    """
    Show an HTML file in Positron
    """

    path: StrictStr = Field(
        description="The fully qualified filesystem path to the HTML file to display",
    )

    title: StrictStr = Field(
        description="A title to be displayed in the viewer. May be empty, and can be superseded by the title in the HTML file.",
    )

    is_plot: StrictBool = Field(
        description="Whether the HTML file is a plot-like object",
    )

    height: StrictInt = Field(
        description="The desired height of the HTML viewer, in pixels. The special value 0 indicates that no particular height is desired, and -1 indicates that the viewer should be as tall as possible.",
    )


class OpenWithSystemParams(BaseModel):
    """
    Open a file or folder with the system default application
    """

    path: StrictStr = Field(
        description="The file path to open with the system default application",
    )


EditorContext.update_forward_refs()

TextDocument.update_forward_refs()

Position.update_forward_refs()

Selection.update_forward_refs()

Range.update_forward_refs()

PreviewSource.update_forward_refs()

DidChangePlotsRenderSettingsParams.update_forward_refs()

DidChangePlotsRenderSettingsRequest.update_forward_refs()

CallMethodParams.update_forward_refs()

CallMethodRequest.update_forward_refs()

BusyParams.update_forward_refs()

OpenEditorParams.update_forward_refs()

NewDocumentParams.update_forward_refs()

ShowMessageParams.update_forward_refs()

ShowQuestionParams.update_forward_refs()

ShowDialogParams.update_forward_refs()

ShowPromptParams.update_forward_refs()

AskForPasswordParams.update_forward_refs()

PromptStateParams.update_forward_refs()

WorkingDirectoryParams.update_forward_refs()

DebugSleepParams.update_forward_refs()

ExecuteCommandParams.update_forward_refs()

EvaluateWhenClauseParams.update_forward_refs()

ExecuteCodeParams.update_forward_refs()

OpenWorkspaceParams.update_forward_refs()

SetEditorSelectionsParams.update_forward_refs()

ModifyEditorSelectionsParams.update_forward_refs()

ShowUrlParams.update_forward_refs()

ShowHtmlFileParams.update_forward_refs()

OpenWithSystemParams.update_forward_refs()
