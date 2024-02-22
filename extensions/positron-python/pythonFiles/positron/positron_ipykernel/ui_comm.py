#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#

#
# AUTO-GENERATED from ui.json; do not edit.
#

# flake8: noqa

# For forward declarations
from __future__ import annotations

import enum
from typing import Any, List, Literal, Optional, Union

from ._vendor.pydantic import BaseModel, Field

Param = Any
CallMethodResult = Any


class EditorContext(BaseModel):
    """
    Editor metadata
    """

    document: TextDocument = Field(
        description="Document metadata",
    )

    contents: List[str] = Field(
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

    path: str = Field(
        description="URI of the resource viewed in the editor",
    )

    eol: str = Field(
        description="End of line sequence",
    )

    is_closed: bool = Field(
        description="Whether the document has been closed",
    )

    is_dirty: bool = Field(
        description="Whether the document has been modified",
    )

    is_untitled: bool = Field(
        description="Whether the document is untitled",
    )

    language_id: str = Field(
        description="Language identifier",
    )

    line_count: int = Field(
        description="Number of lines in the document",
    )

    version: int = Field(
        description="Version number of the document",
    )


class Position(BaseModel):
    """
    A line and character position, such as the position of the cursor.
    """

    character: int = Field(
        description="The zero-based character value, as a Unicode code point offset.",
    )

    line: int = Field(
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

    text: str = Field(
        description="Text of the selection",
    )


@enum.unique
class UiBackendRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the backend ui comm.
    """

    # Run a method in the interpreter and return the result to the frontend
    CallMethod = "call_method"


class CallMethodParams(BaseModel):
    """
    Unlike other RPC methods, `call_method` calls into methods implemented
    in the interpreter and returns the result back to the frontend using
    an implementation-defined serialization scheme.
    """

    method: str = Field(
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
    data: CallMethodRequest


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


class BusyParams(BaseModel):
    """
    Change in backend's busy/idle status
    """

    busy: bool = Field(
        description="Whether the backend is busy",
    )


class OpenEditorParams(BaseModel):
    """
    Open an editor
    """

    file: str = Field(
        description="The path of the file to open",
    )

    line: int = Field(
        description="The line number to jump to",
    )

    column: int = Field(
        description="The column number to jump to",
    )


class ShowMessageParams(BaseModel):
    """
    Show a message
    """

    message: str = Field(
        description="The message to show to the user.",
    )


class PromptStateParams(BaseModel):
    """
    New state of the primary and secondary prompts
    """

    input_prompt: str = Field(
        description="Prompt for primary input.",
    )

    continuation_prompt: str = Field(
        description="Prompt for incomplete input.",
    )


class WorkingDirectoryParams(BaseModel):
    """
    Change the displayed working directory
    """

    directory: str = Field(
        description="The new working directory",
    )


class DebugSleepParams(BaseModel):
    """
    Sleep for n seconds
    """

    ms: float = Field(
        description="Duration in milliseconds",
    )


EditorContext.update_forward_refs()

TextDocument.update_forward_refs()

Position.update_forward_refs()

Selection.update_forward_refs()

CallMethodParams.update_forward_refs()

CallMethodRequest.update_forward_refs()

BusyParams.update_forward_refs()

OpenEditorParams.update_forward_refs()

ShowMessageParams.update_forward_refs()

PromptStateParams.update_forward_refs()

WorkingDirectoryParams.update_forward_refs()

DebugSleepParams.update_forward_refs()
