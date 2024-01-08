#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#

#
# AUTO-GENERATED from frontend.json; do not edit.
#

# For forward declarations
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Dict, List, Union, Optional

JsonData = Union[Dict[str, "JsonData"], List["JsonData"], str, int, float, bool, None]

Param = JsonData
CallMethodResult = JsonData


@enum.unique
class FrontendRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the frontend comm.
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

    method: FrontendRequest = field(
        metadata={"description": "The JSON-RPC method name (call_method)"},
        default=FrontendRequest.CallMethod,
    )

    jsonrpc: str = field(metadata={"description": "The JSON-RPC version specifier"}, default="2.0")


@enum.unique
class FrontendEvent(str, enum.Enum):
    """
    An enumeration of all the possible events that can be sent from the frontend comm.
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
