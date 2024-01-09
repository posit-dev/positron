#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

import pytest

from positron.docstrings import epytext_to_markdown, looks_like_epytext

BASIC_EXAMPLE = """Example of epytext docstring.

This is a paragraph.

@param a: this is the first param
@type a: str
@param b: this is a second param
@type b: int

@return: this function returns something for sure
@rtype: str
"""

BASIC_EXAMPLE_MD = """Example of epytext docstring.

This is a paragraph.

#### Param:

- `a` (str): this is the first param
- `b` (int): this is a second param

#### Return:

(str) this function returns something for sure
"""

ESCAPE_MAGIC_METHOD = """Example.

@param a: see __init__.py
"""

ESCAPE_MAGIC_METHOD_MD = """Example.

#### Param:

- `a`: see \\_\\_init\\_\\_.py
"""

PLAIN_SECTION = """Example.

@param a: some arg

@note: do not use this. Notes can
    include multiple lines.

    There can even be multiple paragraphs.
"""

PLAIN_SECTION_MD = """Example.

#### Param:

- `a`: some arg

#### Note:

do not use this. Notes can include multiple lines.

There can even be multiple paragraphs.
"""

MULTILINE_ARG_DESCRIPTION = """Example of epytext docstring.

@param a: This is a description of
	the parameter including
	several lines.
@type a: str
@param b: this is a second param
	it has two lines
@type b: int
"""

MULTILINE_ARG_DESCRIPTION_MD = """Example of epytext docstring.

#### Param:

- `a` (str): This is a description of the parameter including several lines.
- `b` (int): this is a second param it has two lines
"""

EPYTEXT_CASES = {
    "basic example": {
        "epytext": BASIC_EXAMPLE,
        "md": BASIC_EXAMPLE_MD,
    },
    "escape magic method": {
        "epytext": ESCAPE_MAGIC_METHOD,
        "md": ESCAPE_MAGIC_METHOD_MD,
    },
    "plain section": {
        "epytext": PLAIN_SECTION,
        "md": PLAIN_SECTION_MD,
    },
    "multiline arg description": {
        "epytext": MULTILINE_ARG_DESCRIPTION,
        "md": MULTILINE_ARG_DESCRIPTION_MD,
    },
}


@pytest.mark.parametrize(
    "epytext",
    [case["epytext"] for case in EPYTEXT_CASES.values()],
    ids=EPYTEXT_CASES.keys(),
)
def test_looks_like_epytext_recognises_epytext(epytext):
    assert looks_like_epytext(epytext)


def test_looks_like_epytext_ignores_plain_text():
    assert not looks_like_epytext("This is plain text")
    assert not looks_like_epytext("See Also\n--------\n")


@pytest.mark.parametrize(
    "epytext,markdown",
    [[case["epytext"], case["md"]] for case in EPYTEXT_CASES.values()],
    ids=EPYTEXT_CASES.keys(),
)
def test_epytext_to_markdown(epytext, markdown):
    assert epytext_to_markdown(epytext) == markdown
