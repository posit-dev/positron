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
from dataclasses import dataclass, field
from typing import Dict, List, Union, Optional

JsonData = Union[Dict[str, "JsonData"], List["JsonData"], str, int, float, bool, None]

Param = JsonData
CallMethodResult = JsonData


@dataclass
class EditorContext:
    """
    Editor metadata
    """

    document: TextDocument = field(
        metadata={
            "description": "Document metadata",
        }
    )

    contents: List[str] = field(
        metadata={
            "description": "Document contents",
        }
    )

    selection: Selection = field(
        metadata={
            "description": "The primary selection, i.e. selections[0]",
        }
    )

    selections: List[Selection] = field(
        metadata={
            "description": "The selections in this text editor.",
        }
    )


@dataclass
class TextDocument:
    """
    Document metadata
    """

    path: str = field(
        metadata={
            "description": "URI of the resource viewed in the editor",
        }
    )

    eol: str = field(
        metadata={
            "description": "End of line sequence",
        }
    )

    is_closed: bool = field(
        metadata={
            "description": "Whether the document has been closed",
        }
    )

    is_dirty: bool = field(
        metadata={
            "description": "Whether the document has been modified",
        }
    )

    is_untitled: bool = field(
        metadata={
            "description": "Whether the document is untitled",
        }
    )

    language_id: str = field(
        metadata={
            "description": "Language identifier",
        }
    )

    line_count: int = field(
        metadata={
            "description": "Number of lines in the document",
        }
    )

    version: int = field(
        metadata={
            "description": "Version number of the document",
        }
    )


@dataclass
class Position:
    """
    A line and character position, such as the position of the cursor.
    """

    character: int = field(
        metadata={
            "description": "The zero-based character value, as a Unicode code point offset.",
        }
    )

    line: int = field(
        metadata={
            "description": "The zero-based line value.",
        }
    )


@dataclass
class Selection:
    """
    Selection metadata
    """

    active: Position = field(
        metadata={
            "description": "Position of the cursor.",
        }
    )

    start: Position = field(
        metadata={
            "description": "Start position of the selection",
        }
    )

    end: Position = field(
        metadata={
            "description": "End position of the selection",
        }
    )

    text: str = field(
        metadata={
            "description": "Text of the selection",
        }
    )


@enum.unique
class UiBackendRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the backend ui comm.
    """

    # Run a method in the interpreter and return the result to the frontend
    CallMethod = "call_method"


@dataclass
class CallMethodParams:
    """
    Unlike other RPC methods, `call_method` calls into methods implemented
    in the interpreter and returns the result back to the frontend using
    an implementation-defined serialization scheme.
    """

    method: str = field(
        metadata={
            "description": "The method to call inside the interpreter",
        }
    )

    params: List[Param] = field(
        metadata={
            "description": "The parameters for `method`",
        }
    )


@dataclass
class CallMethodRequest:
    """
    Unlike other RPC methods, `call_method` calls into methods implemented
    in the interpreter and returns the result back to the frontend using
    an implementation-defined serialization scheme.
    """

    def __post_init__(self):
        """Revive RPC parameters after initialization"""
        if isinstance(self.params, dict):
            self.params = CallMethodParams(**self.params)

    params: CallMethodParams = field(
        metadata={"description": "Parameters to the CallMethod method"}
    )

    method: UiBackendRequest = field(
        metadata={"description": "The JSON-RPC method name (call_method)"},
        default=UiBackendRequest.CallMethod,
    )

    jsonrpc: str = field(metadata={"description": "The JSON-RPC version specifier"}, default="2.0")


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


@dataclass
class BusyParams:
    """
    Change in backend's busy/idle status
    """

    busy: bool = field(metadata={"description": "Whether the backend is busy"})


@dataclass
class OpenEditorParams:
    """
    Open an editor
    """

    file: str = field(metadata={"description": "The path of the file to open"})

    line: int = field(metadata={"description": "The line number to jump to"})

    column: int = field(metadata={"description": "The column number to jump to"})


@dataclass
class ShowMessageParams:
    """
    Show a message
    """

    message: str = field(metadata={"description": "The message to show to the user."})


@dataclass
class PromptStateParams:
    """
    New state of the primary and secondary prompts
    """

    input_prompt: str = field(metadata={"description": "Prompt for primary input."})

    continuation_prompt: str = field(metadata={"description": "Prompt for incomplete input."})


@dataclass
class WorkingDirectoryParams:
    """
    Change the displayed working directory
    """

    directory: str = field(metadata={"description": "The new working directory"})


@dataclass
class DebugSleepParams:
    """
    Sleep for n seconds
    """

    ms: float = field(metadata={"description": "Duration in milliseconds"})
