#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

#
# AUTO-GENERATED from plot.json; do not edit.
#

# flake8: noqa

# For forward declarations
from __future__ import annotations

import enum
from typing import Any, List, Literal, Optional, Union

from ._vendor.pydantic import BaseModel, Field, StrictBool, StrictFloat, StrictInt, StrictStr


@enum.unique
class RenderFormat(str, enum.Enum):
    """
    Possible values for Format in Render
    """

    Png = "png"

    Jpeg = "jpeg"

    Svg = "svg"

    Pdf = "pdf"


@enum.unique
class PlotUnit(str, enum.Enum):
    """
    Possible values for PlotUnit
    """

    Pixels = "pixels"

    Inches = "inches"


class IntrinsicSizeResult(BaseModel):
    """
    The intrinsic size of the plot if known
    """

    size: Optional[IntrinsicSize] = Field(
        default=None,
        description="The intrinsic size of a plot",
    )


class IntrinsicSize(BaseModel):
    """
    The intrinsic size of a plot
    """

    width: Union[StrictInt, StrictFloat] = Field(
        description="The intrinsic width of the plot",
    )

    height: Union[StrictInt, StrictFloat] = Field(
        description="The intrinsic height of the plot",
    )

    unit: PlotUnit = Field(
        description="The unit of measurement of the plot's dimensions",
    )

    source: StrictStr = Field(
        description="The source of the intrinsic size e.g. 'Matplotlib'",
    )


class PlotResult(BaseModel):
    """
    A rendered plot
    """

    data: StrictStr = Field(
        description="The plot data, as a base64-encoded string",
    )

    mime_type: StrictStr = Field(
        description="The MIME type of the plot data",
    )


class PlotSize(BaseModel):
    """
    The size of a plot
    """

    height: StrictInt = Field(
        description="The plot's height, in pixels",
    )

    width: StrictInt = Field(
        description="The plot's width, in pixels",
    )


@enum.unique
class PlotBackendRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the backend plot comm.
    """

    # Get the intrinsic size of a plot if known
    GetIntrinsicSize = "get_intrinsic_size"

    # Render a plot
    Render = "render"


class GetIntrinsicSizeRequest(BaseModel):
    """
    The intrinsic size of a plot is the size that the plot would be
    rendered at if no size constraints were applied by Positron.
    """

    method: Literal[PlotBackendRequest.GetIntrinsicSize] = Field(
        description="The JSON-RPC method name (get_intrinsic_size)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class RenderParams(BaseModel):
    """
    Requests a plot to be rendered. TODO: intrinsic size stuff. The plot
    data is returned in a base64-encoded string.
    """

    size: Optional[PlotSize] = Field(
        default=None,
        description="The requested size of the plot. If not provided, the intrinsic size of the plot will be used.",
    )

    pixel_ratio: Union[StrictInt, StrictFloat] = Field(
        description="The pixel ratio of the display device",
    )

    format: RenderFormat = Field(
        description="The requested plot format",
    )


class RenderRequest(BaseModel):
    """
    Requests a plot to be rendered. TODO: intrinsic size stuff. The plot
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
    data: Union[
        GetIntrinsicSizeRequest,
        RenderRequest,
    ] = Field(..., discriminator="method")


@enum.unique
class PlotFrontendEvent(str, enum.Enum):
    """
    An enumeration of all the possible events that can be sent to the frontend plot comm.
    """

    # Notification that a plot has been updated on the backend.
    Update = "update"

    # Show a plot.
    Show = "show"


IntrinsicSizeResult.update_forward_refs()

IntrinsicSize.update_forward_refs()

PlotResult.update_forward_refs()

PlotSize.update_forward_refs()

GetIntrinsicSizeRequest.update_forward_refs()

RenderParams.update_forward_refs()

RenderRequest.update_forward_refs()
