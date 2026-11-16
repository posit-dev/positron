#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""Matching rules for the data explorer's search across all columns (global_search)."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, NamedTuple

from .data_explorer_comm import ColumnDisplayType, FormatOptions

if TYPE_CHECKING:
    import numpy as np

# A null cell matches when the trimmed, lowercased term is exactly one of these
NULL_MARKERS = frozenset({"null", "na", "nan", "none", "nat", "<na>"})

NUMERIC_TYPES = frozenset(
    {ColumnDisplayType.Floating, ColumnDisplayType.Integer, ColumnDisplayType.Decimal}
)

# Types searched by substring on the string the grid displays
DISPLAY_STRING_TYPES = frozenset(
    {
        ColumnDisplayType.Boolean,
        ColumnDisplayType.Date,
        ColumnDisplayType.Datetime,
        ColumnDisplayType.Time,
        ColumnDisplayType.Interval,
        ColumnDisplayType.Object,
    }
)

SEARCHABLE_TYPES = NUMERIC_TYPES | DISPLAY_STRING_TYPES | {ColumnDisplayType.String}

_GROUPED_NUMBER = re.compile(r"[+-]?\d{1,3}(,\d{3})+(\.\d*)?")
_NUMBER = re.compile(r"[+-]?(\d+\.?\d*|\.\d+)")

# (lower, upper, lower_inclusive, upper_inclusive)
Bounds = tuple[float, float, bool, bool]


class SearchTerm(NamedTuple):
    # Lowercased, untrimmed term for substring matching
    text: str
    # Whether null cells match
    matches_null: bool
    # Range numeric cells must fall in, or None if the term is not numeric
    bounds: Bounds | None
    # The value integer cells must equal, or None if the term has decimals or
    # is not numeric
    integer: int | None
    # Options floats are displayed with, or None to match them unrounded
    format_options: FormatOptions | None


def parse_search_term(term: str, format_options: FormatOptions | None = None) -> SearchTerm | None:
    """Classify a search term; returns None when the search is inactive."""
    if not term:
        return None
    stripped = term.strip()
    number = stripped.replace(",", "") if _GROUPED_NUMBER.fullmatch(stripped) else stripped
    is_number = _NUMBER.fullmatch(number) is not None
    return SearchTerm(
        term.lower(),
        stripped.lower() in NULL_MARKERS,
        _numeric_bounds(number) if is_number else None,
        int(number) if is_number and "." not in number else None,
        format_options,
    )


def _numeric_bounds(number: str) -> Bounds:
    # Values that truncate toward zero to the term at its implied precision
    value = float(number)
    step = 10.0 ** -len(number.partition(".")[2])
    eps = step * 1e-9
    if value > 0:
        return (value - eps, value + step - eps, True, False)
    if value < 0:
        return (value - step + eps, value + eps, False, True)
    return (-step + eps, step - eps, False, False)


def display_round(values: np.ndarray, options: FormatOptions) -> np.ndarray:
    """Round float values as they are displayed; NaN where shown in scientific notation."""
    import numpy as np

    magnitude = np.abs(values)
    medium = ((magnitude >= 1) & (magnitude < 10.0**options.max_integral_digits)) | (magnitude == 0)
    small = (magnitude < 1) & (magnitude >= 10.0**-options.small_num_digits)
    return np.select(
        [medium, small],
        [np.round(values, options.large_num_digits), np.round(values, options.small_num_digits)],
        np.nan,
    )


def numeric_mask(
    values: np.ndarray, display_type: ColumnDisplayType, term: SearchTerm
) -> np.ndarray:
    """Return which float values match a numeric term as displayed; NaN and infinities never do."""
    assert term.bounds is not None
    if display_type == ColumnDisplayType.Floating and term.format_options is not None:
        values = display_round(values, term.format_options)
    lower, upper, lower_inclusive, upper_inclusive = term.bounds
    above = values >= lower if lower_inclusive else values > lower
    below = values <= upper if upper_inclusive else values < upper
    return above & below
