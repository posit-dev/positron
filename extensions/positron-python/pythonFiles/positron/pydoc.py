#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import inspect
import pydoc
import re
from typing import Any

from docstring_to_markdown.rst import rst_to_markdown
from markdown_it import MarkdownIt


def _remove_tt(text):
    return text.replace("<tt>", "").replace("</tt>", "")


class _PositronHTMLDoc(pydoc.HTMLDoc):
    def docmodule(self, *args, **kwargs):
        return _remove_tt(super().docmodule(*args, **kwargs))

    def docclass(self, *args, **kwargs):
        return _remove_tt(super().docclass(*args, **kwargs))

    def docroutine(self, *args, **kwargs):
        return _remove_tt(super().docroutine(*args, **kwargs))

    def docother(self, *args, **kwargs):
        return _remove_tt(super().docother(*args, **kwargs))

    def docproperty(self, *args, **kwargs):
        return _remove_tt(super().docproperty(*args, **kwargs))

    def docdata(self, *args, **kwargs):
        return _remove_tt(super().docdata(*args, **kwargs))

    def markup(self, text, escape=None, funcs={}, classes={}, methods={}):
        # Don't do any marking up, let the rst parser handle it.
        return text


# Keep a reference to the original/unpatched `pydoc.getdoc`.
_pydoc_getdoc = pydoc.getdoc


def _getdoc(object: Any) -> str:
    """Override `pydoc.getdoc` to parse reStructuredText docstrings."""
    docstring = _pydoc_getdoc(object)

    markdown = rst_to_markdown(docstring)

    md = MarkdownIt("commonmark", {"html": True}).enable("table")
    html = md.render(markdown)

    return html


def patch_pydoc() -> None:
    """
    Monkey patch pydoc with Positron customizations.
    """
    pydoc.HTMLDoc = _PositronHTMLDoc
    pydoc.getdoc = _getdoc
