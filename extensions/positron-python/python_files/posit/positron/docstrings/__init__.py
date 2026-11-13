#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
import re

from .._vendor.docstring_to_markdown.google import google_to_markdown, looks_like_google
from .._vendor.docstring_to_markdown.rst import rst_to_markdown
from .epytext import epytext_to_markdown, looks_like_epytext

# A NumPy-style parameter line with more than one name, e.g. "X, Y : array-like, optional".
# `rst_to_markdown` only turns single-name lines into list items.
_MULTI_NAME_PARAM_RE = re.compile(
    r"^(?P<indent>\s*)(?P<names>\*{0,2}\w+(?:,\s*\*{0,2}\w+)+) : (?P<type>.+)$"
)

# A Sphinx role that `rst_to_markdown` does not know, e.g. ":rc:`name`" or ":mpltype:`color`".
_SPHINX_ROLE_RE = re.compile(r"(?<![\w`]):(?:[\w-]+:)?[\w-]+:(?=`)")

# The "~" prefix of a cross-reference, e.g. "`~module.Class`" or "`~.module.func()`".
# Only single-backtick dotted names match, so inline code like "``~x.in_(y)``" keeps its
# "~". Markdown links like "[](`~module.Class`)" are kept, since `_linkify` in `pydoc.py`
# handles them.
_TILDE_REF_RE = re.compile(r"(?<![(`])`~(?=\.?[^\d\W][\w.]*(?:\(\))?`(?!`))")

_FENCE_RE = re.compile(r"^\s*(```|~~~)")


def _format_multi_name_param(match: re.Match) -> str:
    names = ", ".join(f"`{name.strip()}`" for name in match.group("names").split(","))
    return f"{match.group('indent')}- {names}: {match.group('type')}"


def _postprocess_markdown(markdown: str) -> str:
    """Fix the Markdown parts that the vendored converters do not handle."""
    lines = markdown.split("\n")
    in_fence = False
    for i, line in enumerate(lines):
        if _FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        line = _MULTI_NAME_PARAM_RE.sub(_format_multi_name_param, line)
        line = _SPHINX_ROLE_RE.sub("", line)
        lines[i] = _TILDE_REF_RE.sub("`", line)
    return "\n".join(lines)


def convert_docstring(docstring: str) -> str:
    if looks_like_google(docstring):
        return _postprocess_markdown(google_to_markdown(docstring))
    if looks_like_epytext(docstring):
        return _postprocess_markdown(epytext_to_markdown(docstring))

    return _postprocess_markdown(rst_to_markdown(docstring))
