#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from positron.execute_request import PositronExecuteRequest, current_execute_request

if TYPE_CHECKING:
    from positron.positron_ipkernel import PositronIPyKernel

    from .conftest import MockSession


def test_parses_code_location() -> None:
    """A full code_location (uri + range) populates the nested model."""
    message = {
        "content": {
            "positron": {
                "code_location": {
                    "uri": "file:///tmp/foo.py",
                    "range": {
                        "start": {"line": 1, "character": 2},
                        "end": {"line": 3, "character": 4},
                    },
                }
            }
        }
    }

    meta = PositronExecuteRequest.from_message(message)

    assert meta.code_location is not None
    assert meta.code_location.uri == "file:///tmp/foo.py"
    assert meta.code_location.range.start.line == 1
    assert meta.code_location.range.start.character == 2
    assert meta.code_location.range.end.line == 3
    assert meta.code_location.range.end.character == 4


def test_parses_kebab_case_fig_size() -> None:
    """Kebab-case `fig-width`/`fig-height` populate `fig_width`/`fig_height`."""
    message = {"content": {"positron": {"fig-width": 6.4, "fig-height": 4.8}}}

    meta = PositronExecuteRequest.from_message(message)

    assert meta.fig_width == 6.4
    assert meta.fig_height == 4.8


def test_parses_snake_case_output_layout() -> None:
    """Snake-case `output_width_px`/`output_pixel_ratio` parse without an alias."""
    message = {"content": {"positron": {"output_width_px": 800, "output_pixel_ratio": 2.0}}}

    meta = PositronExecuteRequest.from_message(message)

    assert meta.output_width_px == 800
    assert meta.output_pixel_ratio == 2.0


def test_missing_positron_key_is_empty() -> None:
    """Missing `content`/`positron` key yields an empty model without raising."""
    meta = PositronExecuteRequest.from_message({})

    assert meta.code_location is None
    assert meta.fig_width is None
    assert meta.fig_height is None
    assert meta.output_width_px is None
    assert meta.output_pixel_ratio is None


def test_fully_malformed_input_degrades_to_empty() -> None:
    """Every field malformed -> empty model via the ValidationError guard, no raise."""
    message = {"content": {"positron": {"code_location": "not-a-dict", "fig-width": [1, 2, 3]}}}

    meta = PositronExecuteRequest.from_message(message)

    assert meta.code_location is None
    assert meta.fig_width is None


def test_malformed_field_does_not_discard_valid_siblings() -> None:
    """A single malformed field degrades to None; valid siblings still parse."""
    message = {
        "content": {
            "positron": {
                "code_location": "not-a-dict",  # invalid
                "fig-width": 6.4,  # valid
                "fig-height": 4.8,  # valid
            }
        }
    }

    meta = PositronExecuteRequest.from_message(message)

    assert meta.code_location is None
    assert meta.fig_width == 6.4
    assert meta.fig_height == 4.8


def test_nested_malformed_value_drops_whole_code_location() -> None:
    """A bad nested range value drops code_location but keeps valid siblings."""
    message = {
        "content": {
            "positron": {
                "code_location": {
                    "uri": "file:///tmp/foo.py",
                    "range": {"start": {"line": "not-an-int"}},
                },
                "fig-width": 6.4,
            }
        }
    }

    meta = PositronExecuteRequest.from_message(message)

    assert meta.code_location is None
    assert meta.fig_width == 6.4


def test_non_dict_positron_is_empty() -> None:
    """A non-dict `positron` (or `content`) yields an empty model without raising."""
    assert PositronExecuteRequest.from_message({"content": {"positron": "nope"}}).fig_width is None
    assert PositronExecuteRequest.from_message({"content": "nope"}).fig_width is None


def test_unknown_keys_are_ignored() -> None:
    """Unknown keys (e.g. `fig-dpi`) pass through harmlessly."""
    message = {"content": {"positron": {"fig-width": 6.4, "fig-dpi": 100}}}

    meta = PositronExecuteRequest.from_message(message)

    assert meta.fig_width == 6.4


@pytest.mark.parametrize(
    ("fig_width", "fig_height", "expected"),
    [
        (6.4, 4.8, (6.4, 4.8)),
        # A lone dimension passes through; the caller fills the other from its default.
        (None, 4.8, (None, 4.8)),
        (6.4, None, (6.4, None)),
        (None, None, None),
        # A non-positive dimension counts as unspecified.
        (-1.0, 4.8, (None, 4.8)),
        (6.4, -1.0, (6.4, None)),
        (-1.0, -1.0, None),
    ],
)
def test_figure_size(
    fig_width: float | None,
    fig_height: float | None,
    expected: tuple[float | None, float | None] | None,
) -> None:
    """`figure_size` keeps each positive dimension and is None only when neither is set."""
    message = {"content": {"positron": {"fig-width": fig_width, "fig-height": fig_height}}}

    meta = PositronExecuteRequest.from_message(message)

    assert meta.figure_size == expected


def test_current_execute_request_reads_figure_size(
    kernel: PositronIPyKernel, session: MockSession
) -> None:
    """`current_execute_request` parses the kernel's current shell parent message."""
    message = session.msg(
        "execute_request", content={"positron": {"fig-width": 6.4, "fig-height": 4.8}}
    )

    kernel.set_parent([], message, channel="shell")

    assert current_execute_request().figure_size == (6.4, 4.8)


def test_current_execute_request_with_no_metadata(
    kernel: PositronIPyKernel, session: MockSession
) -> None:
    """A shell parent message without `content.positron` yields an empty model."""
    message = session.msg("execute_request", content={})

    kernel.set_parent([], message, channel="shell")

    assert current_execute_request().figure_size is None
