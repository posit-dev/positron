#
# Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

#
# AUTO-GENERATED from help.json; do not edit.
#

# flake8: noqa

# For forward declarations
from __future__ import annotations

import enum
from typing import Any, List, Literal, Optional, Union

from ._vendor.pydantic import BaseModel, Field, StrictBool, StrictFloat, StrictInt, StrictStr


class HelpTopicSuggestion(BaseModel):
    """
    A help topic offered as an autocomplete suggestion.
    """

    label: StrictStr = Field(
        description="The topic label shown to the user.",
    )

    topic: StrictStr = Field(
        description="The exact topic value used to open help.",
    )

    detail: Optional[StrictStr] = Field(
        default=None,
        description="Optional context such as the package containing the topic.",
    )


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

    # Search the active interpreter's help system.
    SearchHelp = "search_help"

    # List help topics for autocomplete.
    GetHelpTopics = "get_help_topics"


class ShowHelpTopicParams(BaseModel):
    """
    Requests that the help backend look for a help topic and, if found,
    show it. If the topic is found, it will be shown via a Show Help
    notification. If the topic is not found, no notification will be
    delivered.
    """

    topic: StrictStr = Field(
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


class SearchHelpParams(BaseModel):
    """
    Searches interpreter-wide help and displays the resulting page via a
    Show Help notification.
    """

    query: StrictStr = Field(
        description="The help query to search for",
    )


class SearchHelpRequest(BaseModel):
    """
    Searches interpreter-wide help and displays the resulting page via a
    Show Help notification.
    """

    params: SearchHelpParams = Field(
        description="Parameters to the SearchHelp method",
    )

    method: Literal[HelpBackendRequest.SearchHelp] = Field(
        description="The JSON-RPC method name (search_help)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class GetHelpTopicsRequest(BaseModel):
    """
    Returns interpreter-wide help topics that can be offered as search
    suggestions.
    """

    method: Literal[HelpBackendRequest.GetHelpTopics] = Field(
        description="The JSON-RPC method name (get_help_topics)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class HelpBackendMessageContent(BaseModel):
    comm_id: str
    data: Union[
        ShowHelpTopicRequest,
        SearchHelpRequest,
        GetHelpTopicsRequest,
    ] = Field(..., discriminator="method")


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

    content: StrictStr = Field(
        description="The help content to show",
    )

    kind: ShowHelpKind = Field(
        description="The type of content to show",
    )

    focus: StrictBool = Field(
        description="Whether to focus the Help pane when the content is displayed.",
    )


HelpTopicSuggestion.update_forward_refs()

ShowHelpTopicParams.update_forward_refs()

ShowHelpTopicRequest.update_forward_refs()

SearchHelpParams.update_forward_refs()

SearchHelpRequest.update_forward_refs()

GetHelpTopicsRequest.update_forward_refs()

ShowHelpParams.update_forward_refs()
