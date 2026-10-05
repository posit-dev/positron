#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import logging
from collections.abc import Mapping
from functools import partial
from typing import TYPE_CHECKING, Any

from ..access_keys import encode_access_key
from ..session_mode import SessionMode
from .data_explorer_formatter import PositronDataExplorerFormatter, _resolve_variable_name

if TYPE_CHECKING:
    from ..positron_ipkernel import PositronIPyKernel
    from .display_formatter import PositronDisplayFormatter


logger = logging.getLogger(__name__)


def create_object_explorer_formatter(
    parent: PositronDisplayFormatter, kernel: PositronIPyKernel
) -> PositronObjectExplorerFormatter:
    """Build an object explorer formatter."""
    formatter = PositronObjectExplorerFormatter(parent=parent)
    for type_ in (dict, list, tuple):
        formatter.for_type(type_, partial(_display_object_explorer, kernel=kernel))
    return formatter


class PositronObjectExplorerFormatter(PositronDataExplorerFormatter):
    """Emits application/vnd.positron.objectExplorer+json for nested data."""

    format_type = "application/vnd.positron.objectExplorer+json"


def _is_nested(obj: Any) -> bool:
    """
    Whether a value is nested data worth exploring inline.

    A non-empty mapping is; so is a non-empty list or tuple holding a mapping, list, or tuple.
    Flat sequences like `[1, 2, 3]` keep their plain text output.
    """
    if isinstance(obj, Mapping):
        return len(obj) > 0
    return any(isinstance(item, (Mapping, list, tuple)) for item in obj)


def _display_object_explorer(obj: Any, kernel: PositronIPyKernel) -> dict[str, Any] | None:
    """Show nested data in an inline object explorer."""
    if kernel.session_mode != SessionMode.NOTEBOOK or not _is_nested(obj):
        return None

    try:
        var_name = _resolve_variable_name(kernel.shell, obj)
        variable_path = [encode_access_key(var_name)] if var_name is not None else None
        title = var_name if var_name is not None else type(obj).__name__

        comm_id = kernel.object_explorer_service.register_object(
            obj,
            title,
            variable_path=variable_path,
            root_accessor=var_name,
            inline_only=True,
        )
        payload: dict[str, Any] = {"version": 1, "comm_id": comm_id, "title": title}
        if variable_path is not None:
            payload["variable_path"] = variable_path
        return payload
    except Exception:
        logger.warning("Failed to create inline object explorer", exc_info=True)
        return None
