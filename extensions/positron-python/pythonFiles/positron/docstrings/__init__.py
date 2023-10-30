#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#
from docstring_to_markdown.rst import rst_to_markdown
from docstring_to_markdown.google import looks_like_google, google_to_markdown

from .epytext import looks_like_epytext, epytext_to_markdown


def convert_docstring(docstring: str) -> str:
    if looks_like_google(docstring):
        return google_to_markdown(docstring)
    if looks_like_epytext(docstring):
        return epytext_to_markdown(docstring)

    return rst_to_markdown(docstring)
