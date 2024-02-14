#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#

#
# AUTO-GENERATED from help.json; do not edit.
#

# flake8: noqa

# For forward declarations
from __future__ import annotations

import enum
from typing import Any, List, Literal, Optional, Union

from ._vendor.pydantic import BaseModel, Field


@enum.unique
class ShowHelpKind(str, enum.Enum):
    """
    Possible values for Kind in ShowHelp
    """

    Html = "html"

    Markdown = "markdown"

    Url = "url"


@enum.unique
class HelpBackendRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the backend help comm.
    """

    # Look for and, if found, show a help topic.
    ShowHelpTopic = "show_help_topic"


class ShowHelpTopicParams(BaseModel):
    """
    Requests that the help backend look for a help topic and, if found,
    show it. If the topic is found, it will be shown via a Show Help
    notification. If the topic is not found, no notification will be
    delivered.
    """

    topic: str = Field(
        description="The help topic to show",
    )


class ShowHelpTopicRequest(BaseModel):
    """
    Requests that the help backend look for a help topic and, if found,
    show it. If the topic is found, it will be shown via a Show Help
    notification. If the topic is not found, no notification will be
    delivered.
    """

    params: ShowHelpTopicParams = Field(
        description="Parameters to the ShowHelpTopic method",
    )

    method: Literal[HelpBackendRequest.ShowHelpTopic] = Field(
        description="The JSON-RPC method name (show_help_topic)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class HelpBackendMessageContent(BaseModel):
    comm_id: str
    data: ShowHelpTopicRequest


@enum.unique
class HelpFrontendEvent(str, enum.Enum):
    """
    An enumeration of all the possible events that can be sent to the frontend help comm.
    """

    # Request to show help in the frontend
    ShowHelp = "show_help"


class ShowHelpParams(BaseModel):
    """
    Request to show help in the frontend
    """

    content: str = Field(
        description="The help content to show",
    )

    kind: ShowHelpKind = Field(
        description="The type of content to show",
    )

    focus: bool = Field(
        description="Whether to focus the Help pane when the content is displayed.",
    )


ShowHelpTopicParams.update_forward_refs()

ShowHelpTopicRequest.update_forward_refs()

ShowHelpParams.update_forward_refs()
