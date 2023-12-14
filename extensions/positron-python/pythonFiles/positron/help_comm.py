#
#  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

#
# AUTO-GENERATED from help.json; do not edit.
#

import enum
from dataclasses import dataclass, field


@enum.unique
class ShowHelpKind(str, enum.Enum):
    """
    Possible values for the Kind parameter of the ShowHelp method.
    """

    Html = "html"

    Markdown = "markdown"

    Url = "url"


@enum.unique
class HelpRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the help comm.
    """

    # Look for and, if found, show a help topic.
    ShowHelpTopic = "show_help_topic"


@dataclass
class ShowHelpTopicParams:
    """
    Requests that the help backend look for a help topic and, if found,
    show it. If the topic is found, it will be shown via a Show Help
    notification. If the topic is not found, no notification will be
    delivered.
    """

    topic: str = field(
        metadata={
            "description": "The help topic to show",
        }
    )


@dataclass
class ShowHelpTopicRequest:
    """
    Requests that the help backend look for a help topic and, if found,
    show it. If the topic is found, it will be shown via a Show Help
    notification. If the topic is not found, no notification will be
    delivered.
    """

    def __post_init__(self):
        """Revive RPC parameters after initialization"""
        if isinstance(self.params, dict):
            self.params = ShowHelpTopicParams(**self.params)

    params: ShowHelpTopicParams = field(
        metadata={"description": "Parameters to the ShowHelpTopic method"}
    )

    method: HelpRequest = field(
        metadata={"description": "The JSON-RPC method name (show_help_topic)"},
        default=HelpRequest.ShowHelpTopic,
    )

    jsonrpc: str = field(metadata={"description": "The JSON-RPC version specifier"}, default="2.0")


@enum.unique
class HelpEvent(str, enum.Enum):
    """
    An enumeration of all the possible events that can be sent from the help comm.
    """

    # Request to show help in the frontend
    ShowHelp = "show_help"


@dataclass
class ShowHelpParams:
    """
    Request to show help in the frontend
    """

    content: str = field(metadata={"description": "The help content to show"})

    kind: ShowHelpKind = field(metadata={"description": "The type of content to show"})

    focus: bool = field(
        metadata={"description": "Whether to focus the Help pane when the content is displayed."}
    )
