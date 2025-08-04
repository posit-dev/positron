#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
OSC8 functionality.

See https://iterm2.com/3.2/documentation-escape-codes.html for a description.
"""

# Define a few OSC8 excape codes for convenience.
_ESC = "\x1b"
_OSC = _ESC + "]"
_OSC8 = _OSC + "8"
_ST = _ESC + "\\"


def _start_hyperlink(uri: str = "", params: dict[str, str] | None = None) -> str:
    """Start sequence for a hyperlink."""
    if params is None:
        params = {}
    params_str = ":".join(f"{key}={value}" for key, value in params.items())
    return f"{_OSC8};{params_str};{uri}" + _ST


def _end_hyperlink() -> str:
    """End sequence for a hyperlink."""
    return _start_hyperlink()


def link(uri: str, label: str, params: dict[str, str] | None = None) -> str:
    """Create a hyperlink with the given label, URI, and params."""
    if params is None:
        params = {}
    return _start_hyperlink(uri, params) + label + _end_hyperlink()
