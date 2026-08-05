#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import logging
from typing import Optional, Union, cast

from ._vendor.pydantic import (
    BaseModel,
    Field,
    StrictFloat,
    StrictInt,
    StrictStr,
    ValidationError,
)

logger = logging.getLogger(__name__)

Number = Union[StrictInt, StrictFloat]


class Position(BaseModel):
    """A zero-indexed (line, character) position within a document."""

    line: StrictInt = 0
    character: StrictInt = 0


class Range(BaseModel):
    """A range within a document."""

    start: Position = Field(default_factory=Position)
    end: Position = Field(default_factory=Position)


class Location(BaseModel):
    """A range within a document, identified by URI."""

    uri: StrictStr
    range: Range = Field(default_factory=Range)


class PositronExecuteRequest(BaseModel):
    """Typed view of an execute_request's `content.positron` object."""

    code_location: Optional[Location] = None
    fig_width: Optional[Number] = Field(
        None, alias="fig-width", description="Figure width in inches"
    )
    fig_height: Optional[Number] = Field(
        None, alias="fig-height", description="Figure height in inches"
    )
    output_width_px: Optional[Number] = Field(
        None, description="Output area width in logical (CSS) pixels"
    )
    output_pixel_ratio: Optional[Number] = Field(
        None, description="Output area device pixel ratio, e.g. 1.0 or 2.0"
    )

    @property
    def figure_size(self) -> Optional[tuple[Optional[float], Optional[float]]]:
        """The figure size in inches, if specified.

        Either dimension may be set alone; a missing or non-positive dimension is
        None, for the caller to fill from its own default. None when neither
        dimension is specified.
        """
        w = self.fig_width if self.fig_width is not None and self.fig_width > 0 else None
        h = self.fig_height if self.fig_height is not None and self.fig_height > 0 else None
        if w is None and h is None:
            return None
        return (w, h)

    @classmethod
    def from_message(cls, message: dict) -> "PositronExecuteRequest":
        """Parse from a Jupyter shell message."""
        content = message.get("content", {})
        positron = content.get("positron", {}) if isinstance(content, dict) else {}
        if not isinstance(positron, dict):
            return cls.parse_obj({})

        try:
            return cls.parse_obj(positron)
        except ValidationError as e:
            # Drop only the top-level keys that failed validation and re-parse,
            # so one malformed field doesn't discard the valid ones. Pydantic v1
            # reports each error's location by wire key, so `loc[0]` matches the
            # keys of `positron` directly.
            bad_keys = {err["loc"][0] for err in e.errors()}
            cleaned = {k: v for k, v in positron.items() if k not in bad_keys}
            try:
                return cls.parse_obj(cleaned)
            except ValidationError:
                logger.debug("Failed to parse positron execute request", exc_info=True)
                return cls.parse_obj({})


def current_execute_request() -> PositronExecuteRequest:
    """The Positron `execute_request` currently being handled, if any."""
    # No contextvar of our own needed here: ipykernel's `get_parent("shell")` is
    # already backed by a `ContextVar` (see `_shell_parent` in kernelbase.py), so
    # this is async/thread-safe as-is.
    # Imported lazily to avoid a circular import.
    from .positron_ipkernel import PositronIPyKernel

    kernel = cast("PositronIPyKernel", PositronIPyKernel.instance())
    execute_request_message = kernel.get_parent("shell")
    return PositronExecuteRequest.from_message(execute_request_message)
