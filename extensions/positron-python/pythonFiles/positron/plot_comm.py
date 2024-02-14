#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#

#
# AUTO-GENERATED from plot.json; do not edit.
#

# flake8: noqa

# For forward declarations
from __future__ import annotations

import enum
from typing import Any, List, Literal, Optional, Union

from ._vendor.pydantic import BaseModel, Field


class PlotResult(BaseModel):
    """
    A rendered plot
    """

    data: str = Field(
        description="The plot data, as a base64-encoded string",
    )

    mime_type: str = Field(
        description="The MIME type of the plot data",
    )


@enum.unique
class PlotBackendRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the backend plot comm.
    """

    # Render a plot
    Render = "render"


class RenderParams(BaseModel):
    """
    Requests a plot to be rendered at a given height and width. The plot
    data is returned in a base64-encoded string.
    """

    height: int = Field(
        description="The requested plot height, in pixels",
    )

    width: int = Field(
        description="The requested plot width, in pixels",
    )

    pixel_ratio: float = Field(
        description="The pixel ratio of the display device",
    )


class RenderRequest(BaseModel):
    """
    Requests a plot to be rendered at a given height and width. The plot
    data is returned in a base64-encoded string.
    """

    params: RenderParams = Field(
        description="Parameters to the Render method",
    )

    method: Literal[PlotBackendRequest.Render] = Field(
        description="The JSON-RPC method name (render)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class PlotBackendMessageContent(BaseModel):
    comm_id: str
    data: RenderRequest


@enum.unique
class PlotFrontendEvent(str, enum.Enum):
    """
    An enumeration of all the possible events that can be sent to the frontend plot comm.
    """

    # Notification that a plot has been updated on the backend.
    Update = "update"


PlotResult.update_forward_refs()

RenderParams.update_forward_refs()

RenderRequest.update_forward_refs()
