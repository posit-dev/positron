#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#

#
# AUTO-GENERATED from plot.json; do not edit.
#

import enum
from dataclasses import dataclass, field
from typing import Dict, List, Union

JsonData = Union[Dict[str, "JsonData"], List["JsonData"], str, int, float, bool, None]


@dataclass
class PlotResult:
    """
    A rendered plot
    """

    data: str = field(
        metadata={
            "description": "The plot data, as a base64-encoded string",
        }
    )

    mime_type: str = field(
        metadata={
            "description": "The MIME type of the plot data",
        }
    )


@enum.unique
class PlotRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the plot comm.
    """

    # Render a plot
    Render = "render"


@dataclass
class RenderParams:
    """
    Requests a plot to be rendered at a given height and width. The plot
    data is returned in a base64-encoded string.
    """

    height: int = field(
        metadata={
            "description": "The requested plot height, in pixels",
        }
    )

    width: int = field(
        metadata={
            "description": "The requested plot width, in pixels",
        }
    )

    pixel_ratio: float = field(
        metadata={
            "description": "The pixel ratio of the display device",
        }
    )


@dataclass
class RenderRequest:
    """
    Requests a plot to be rendered at a given height and width. The plot
    data is returned in a base64-encoded string.
    """

    def __post_init__(self):
        """Revive RPC parameters after initialization"""
        if isinstance(self.params, dict):
            self.params = RenderParams(**self.params)

    params: RenderParams = field(metadata={"description": "Parameters to the Render method"})

    method: PlotRequest = field(
        metadata={"description": "The JSON-RPC method name (render)"}, default=PlotRequest.Render
    )

    jsonrpc: str = field(metadata={"description": "The JSON-RPC version specifier"}, default="2.0")


@enum.unique
class PlotEvent(str, enum.Enum):
    """
    An enumeration of all the possible events that can be sent from the plot comm.
    """

    # Notification that a plot has been updated on the backend.
    Update = "update"
