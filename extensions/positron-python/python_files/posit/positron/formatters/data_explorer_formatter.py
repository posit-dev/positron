#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import logging
from functools import partial
from typing import TYPE_CHECKING, Any, Literal, Union

from IPython.core.formatters import (
    BaseFormatter,
    catch_format_error,
)

from ..access_keys import encode_access_key
from ..session_mode import SessionMode

if TYPE_CHECKING:
    import pandas as pd
    import polars as pl

    from ..positron_ipkernel import PositronIPyKernel, PositronShell
    from .display_formatter import PositronDisplayFormatter

    Table = Union[pd.DataFrame, pd.Series, pl.DataFrame, pl.Series]


logger = logging.getLogger(__name__)


_TABLE_TYPES = [
    ("pandas.DataFrame", "pandas"),
    ("pandas.core.frame.DataFrame", "pandas"),
    ("pandas.Series", "pandas"),
    ("pandas.core.series.Series", "pandas"),
    ("polars.dataframe.frame.DataFrame", "polars"),
    ("polars.series.series.Series", "polars"),
]


def create_data_explorer_formatter(
    parent: PositronDisplayFormatter, kernel: PositronIPyKernel
) -> PositronDataExplorerFormatter:
    """Build a data explorer formatter."""
    formatter = PositronDataExplorerFormatter(parent=parent)
    for type_name, source in _TABLE_TYPES:
        formatter.for_type(
            type_name,
            partial(_display_data_explorer, kernel=kernel, source=source),
        )
    return formatter


class PositronDataExplorerFormatter(BaseFormatter):
    """Emits application/vnd.positron.dataExplorer+json for registered table types."""

    format_type = "application/vnd.positron.dataExplorer+json"
    _return_type = dict

    parent: PositronDisplayFormatter

    @catch_format_error
    def __call__(self, obj):
        # Override BaseFormatter.__call__ to avoid falling back to __repr__.
        if not self.enabled:
            return None

        try:
            # Lookup the printer for the table type (registered in create_data_explorer_formatter).
            printer = self.lookup(obj)
        except KeyError:
            return None

        return printer(obj)


def _resolve_variable_name(shell: PositronShell, obj: Any) -> str | None:
    """Find the top-level variable name for an object by scanning user_ns.

    Returns the first non-hidden variable name whose value is the same
    object (by identity), or None if no match is found.
    """
    if shell is None:
        return None

    user_ns = shell.user_ns or {}
    hidden = shell.user_ns_hidden or {}

    for name, value in user_ns.items():
        if value is not obj:
            continue
        # Skip hidden variables (IPython internals like _, __, _oh, etc.)
        # For _, only treat it as hidden if the value is the same object
        # as in user_ns_hidden (i.e. the user hasn't reassigned it).
        if name == "_":
            if name in hidden and value is hidden[name]:
                continue
        elif name in hidden:
            continue
        return name

    return None


def _display_data_explorer(
    obj: Table,
    kernel: PositronIPyKernel,
    source: Literal["pandas", "polars"],
) -> dict[str, Any] | None:
    """Print a table object to the inline data explorer."""
    # Only add inline data explorer for notebook mode
    if kernel.session_mode != SessionMode.NOTEBOOK:
        return None

    try:
        rows, cols = _get_table_shape(obj)

        # Try to resolve the top-level variable name
        var_name = _resolve_variable_name(kernel.shell, obj)
        if var_name is not None:
            title, variable_path = var_name, [encode_access_key(var_name)]
        else:
            title, variable_path = source, None

        # Register the table with data explorer service and get comm_id
        comm_id = kernel.data_explorer_service.register_table(
            obj,
            title,
            variable_path=variable_path,
            inline_only=True,
        )
        payload = {
            "version": 1,
            "comm_id": comm_id,
            "shape": {"rows": rows, "columns": cols},
            "title": title,
            "source": source,
        }
        if variable_path is not None:
            payload["variable_path"] = variable_path

        return payload
    except Exception:
        logger.warning("Failed to create inline data explorer", exc_info=True)
        return None


def _get_table_shape(obj: Table) -> tuple[int, int]:
    """Get the shape (rows, columns) of a table object."""
    shape = obj.shape
    # Handle Series which has 1D shape
    if len(shape) == 1:
        return (shape[0], 1)
    return (shape[0], shape[1])
