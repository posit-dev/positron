from types import ModuleType
from typing import Any, Callable, List, Tuple

from positron.pydoc import _PositronHTMLDoc
import pandas as pd
import pytest

from positron.pydoc import (
    _Attr,
    _compact_signature,
    _get_summary,
    _tabulate_attrs,
    _untyped_signature,
    _PositronHTMLDoc,
)


# Test data


def _test_func(a: int, b: str, c=1, *args, **kwargs) -> None:
    """
    Function summary.

    Function long description.
    """
    pass


class _DummyAttribute:
    """
    Attribute summary.

    Attribute long description.
    """


class _A:
    """
    Class summary.

    Class long description.
    """

    attr = _DummyAttribute()

    def __init__(self) -> None:
        """This should not be documented."""

    def method(self, a: int, b: str, c=1, *args, **kwargs) -> None:
        """
        Method summary, may contain [links](target).

        Method long description.
        """
        pass


_module = ModuleType(
    "test_module",
    """\
Module summary.

Module long description.""",
)
setattr(_module, "A", _A)
setattr(_module, "test_func", _test_func)


# Tests


_html = _PositronHTMLDoc()


@pytest.mark.parametrize(
    ("func", "args"),
    [
        (_html.html_index, ()),
        (_html.html_error, ("test-url", Exception())),
        # NOTE: For some reason, including html_search causes an existing test to fail:
        #       tests/unittestadapter/test_discovery.py::test_error_discovery
        # (_html.html_search, ("pydoc",)),
        (_html.html_getobj, ("pydoc",)),  # Module
        (_html.html_getobj, ("pydoc.Helper",)),  # Class
        (_html.html_getobj, ("pydoc.getdoc",)),  # Function
        (_html.html_getobj, ("pydoc.help",)),  # Data
        (_html.html_keywords, ()),
        (_html.html_topicpage, ("FLOAT",)),
        (_html.html_topics, ()),
    ],
)
def test_pydoc_py311_breaking_changes(func: Callable, args: Tuple[Any, ...]) -> None:
    """
    Python 3.11 introduced a breaking change into pydoc.HTMLDoc methods: heading, section, and
    bigsection. Ensure that we've patched these to work in all versions from 3.8+.

    NOTE: We can remove this test once we have better end-to-end tests on the generated HTML for
          specific objects.
    """
    # These will error unless we patch pydoc.HTMLDoc heading, section, and bigsection.
    func(*args)


@pytest.mark.parametrize(
    ("func", "expected"),
    [
        # No args
        (pd.DataFrame.isna, "()"),
        # One arg
        (pd.DataFrame.isin, "(values)"),
        # Two args
        (pd.DataFrame.isetitem, "(loc, value)"),
        # Required and optional args
        (pd.DataFrame.ne, "(other[, axis, level])"),  # type: ignore
        # Only optional args
        (pd.DataFrame.itertuples, "([index, name])"),
        # Only keyword-only args, some required, some optional
        (pd.DataFrame.pivot, "(*, columns[, index, values])"),
        # Only keyword-only optional args
        (pd.DataFrame.ffill, "(*[, axis, inplace, limit, downcast])"),
        # Required args and optional keyword-only args
        (pd.DataFrame.set_axis, "(labels, *[, axis, copy])"),
        # Variadic positional and variadic keyword args
        (pd.DataFrame.pipe, "(func, *args, **kwargs)"),
        # Only variadic keyword args
        (pd.DataFrame.assign, "(**kwargs)"),
        # Variadic positional and optional keyword only
        (pd.DataFrame.transpose, "(*args[, copy])"),
        # Truncated
        (pd.DataFrame.update, "(other[, join, overwrite, ...])"),
        (pd.DataFrame.value_counts, "([subset, normalize, sort, ...])"),
        (pd.DataFrame.drop_duplicates, "([subset, *, keep, inplace, ...])"),
        # Non-callable
        (pd, None),
    ],
)
def test_compact_signature(func: Callable, expected: str) -> None:
    result = _compact_signature(func)
    assert result == expected


@pytest.mark.parametrize(
    ("func", "expected"),
    [
        (pd.DataFrame, "(data=None, index=None, columns=None, dtype=None, copy=None)"),
        (_test_func, "(a, b, c=1, *args, **kwargs)"),
    ],
)
def test_untyped_signature(func: Callable, expected: str) -> None:
    result = _untyped_signature(func)
    assert result == expected


@pytest.mark.parametrize(
    ("attrs", "expected"),
    [
        # Empty
        ([], ["<table>", "<tbody>", "</tbody>", "</table>"]),
        # One attr
        (
            [_Attr(name="attr", cls=_A, value=_DummyAttribute)],
            [
                "<table>",
                "<tbody>",
                "<tr>",
                "<td>",
                '<p><a href="_A.attr"><code>attr</code></a>()</p>',
                "</td>",
                "<td>",
                "Attribute summary.",
                "</td>",
                "</tr>",
                "</tbody>",
                "</table>",
            ],
        ),
    ],
)
def test_tabulate_attrs(attrs: List[_Attr], expected: List[str]) -> None:
    result = _tabulate_attrs(attrs)
    assert result == expected


@pytest.mark.parametrize(
    ("obj", "expected"),
    [
        (pd.DataFrame, "Two-dimensional, size-mutable, potentially heterogeneous tabular data."),
    ],
)
def test_get_summary(obj: Any, expected: str) -> None:
    result = _get_summary(obj)
    assert result == expected


def _assert_html_equal(result: str, expected: str) -> None:
    # Ignore whitespace between lines.
    # This is specifically to handle the fact that black removes trailing whitespaces from our
    # `expected` HTML above.
    _result = [line.strip() for line in result.split("\n")]
    _expected = [line.strip() for line in expected.split("\n")]
    assert _result == _expected


def test_document_module() -> None:
    result = _html.document(_module)
    expected = """\

<table class="heading">
<tr class="heading-text decor">
<td class="title">&nbsp;<br><strong class="title">test_module</strong></td>
<td class="extra"><a href=".">index</a><br>(built-in)</td></tr></table>
    <p>Module summary.</p>
<p>Module long description.</p>
<p>
<table class="section">
<tr class="decor index-decor heading-text">
<td class="section-title" colspan=3>&nbsp;<br><strong class="bigsection">Classes</strong></td></tr>

<tr><td class="decor index-decor"><span class="code">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></td><td>&nbsp;</td>
<td class="singlecolumn"><table>
<tbody>
<tr>
<td>
<p><a href="test_module.A"><code>A</code></a>()</p>
</td>
<td>
Class summary.
</td>
</tr>
</tbody>
</table></td></tr></table><p>
<table class="section">
<tr class="decor functions-decor heading-text">
<td class="section-title" colspan=3>&nbsp;<br><strong class="bigsection">Functions</strong></td></tr>

<tr><td class="decor functions-decor"><span class="code">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></td><td>&nbsp;</td>
<td class="singlecolumn"><table>
<tbody>
<tr>
<td>
<p><a href="test_module.test_func"><code>test_func</code></a>(a, b[, c, *args, **kwargs])</p>
</td>
<td>
Function summary.
</td>
</tr>
</tbody>
</table></td></tr></table>"""

    _assert_html_equal(result, expected)


def test_document_class():
    result = _html.document(_A)
    expected = """\

<table class="heading">
<tr class="heading-text decor">
<td class="title">&nbsp;<br><strong>_A</strong></td>
<td class="extra">&nbsp;</td></tr></table>
    <code><strong><em>class</em> _A<em>()</em></strong></code><p>Class summary.</p>
<p>Class long description.</p>
<p>
<table class="section">
<tr class="decor index-decor heading-text">
<td class="section-title" colspan=3>&nbsp;<br><strong class="bigsection">Attributes</strong></td></tr>

<tr><td class="decor index-decor"><span class="code">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></td><td>&nbsp;</td>
<td class="singlecolumn"><table>
<tbody>
<tr>
<td>
<p><a href="_A.attr"><code>attr</code></a></p>
</td>
<td>
Attribute summary.
</td>
</tr>
</tbody>
</table></td></tr></table><p>
<table class="section">
<tr class="decor functions-decor heading-text">
<td class="section-title" colspan=3>&nbsp;<br><strong class="bigsection">Methods</strong></td></tr>

<tr><td class="decor functions-decor"><span class="code">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></td><td>&nbsp;</td>
<td class="singlecolumn"><table>
<tbody>
<tr>
<td>
<p><a href="_A.method"><code>method</code></a>(a, b[, c, *args, **kwargs])</p>
</td>
<td>
Method summary, may contain [links](target).
</td>
</tr>
</tbody>
</table></td></tr></table>"""

    _assert_html_equal(result, expected)
