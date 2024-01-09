#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

from types import ModuleType
from typing import Any, Callable, List, Tuple

import numpy as np
import pandas as pd
import pytest

from positron.pydoc import (
    _Attr,
    _compact_signature,
    _get_summary,
    _getdoc,
    _PositronHTMLDoc,
    _resolve,
    _tabulate_attrs,
    _untyped_signature,
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


def _test_getdoc_links_arguments_section() -> None:
    """
    Summary.

    Parameters
    ----------
    copy : bool
        Uses `copy.copy`.
    second : int
        Description 2.
    """


def _test_getdoc_md_links_arguments_section() -> None:
    """
    Summary.

    Parameters
    ----------
    copy : bool
        Uses [](`~copy.copy`).
    second : int
        Description 2.
    """


_TEST_GETDOC_LINKS_ARGS_SECTION_OUTPUT = """\
<p>Summary.</p>
<h4>Parameters</h4>
<ul>
<li><code>copy</code>: bool
Uses <a href="get?key=copy.copy"><code>copy.copy</code></a>.</li>
<li><code>second</code>: int
Description 2.</li>
</ul>
"""


def _test_getdoc_links_see_also_section() -> None:
    """
    Summary.

    See Also
    --------
    copy.copy : Description 1.
    """


def _test_getdoc_md_links_see_also_section() -> None:
    """
    Summary.

    See Also
    --------
    [](`~copy.copy`) : Description 1.
    """


_TEST_GETDOC_LINKS_SEE_ALSO_SECTION_OUTPUT = """\
<p>Summary.</p>
<h4>See Also</h4>
<ul>
<li><a href="get?key=copy.copy"><code>copy.copy</code></a>: Description 1.</li>
</ul>
"""


def _test_getdoc_code_blocks() -> None:
    """
    >>> import pandas as pd
    >>> pd.DataFrame()
    Empty DataFrame
    Columns: []
    Index: []
    """


def _test_getdoc_urls() -> None:
    """
    Note
    ----
    See https://url.com for more info
    """


def _test_getdoc_md_urls() -> None:
    """
    Note
    ----
    See [url](https://url.com) for more info
    """


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
        ([], ['<table class="autosummary">', "<tbody>", "</tbody>", "</table>"]),
        # One attr
        (
            [_Attr(name="attr", cls=_A, value=_DummyAttribute)],
            [
                '<table class="autosummary">',
                "<tbody>",
                "<tr>",
                "<td>",
                '<a href="_A.attr"><code>attr</code></a>()',
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
<h1>test_module</h1><p>Module summary.</p>
<p>Module long description.</p>
<section class="classes">
<h2>Classes</h2>
<table class="autosummary">
<tbody>
<tr>
<td>
<a href="test_module.A"><code>A</code></a>()
</td>
<td>
Class summary.
</td>
</tr>
</tbody>
</table>
</section><section class="functions">
<h2>Functions</h2>
<table class="autosummary">
<tbody>
<tr>
<td>
<a href="test_module.test_func"><code>test_func</code></a>(a, b[, c, *args, **kwargs])
</td>
<td>
Function summary.
</td>
</tr>
</tbody>
</table>
</section>"""

    _assert_html_equal(result, expected)


def test_document_class():
    result = _html.document(_A)
    expected = """\
<h1>_A</h1><code><strong><em>class</em> _A<em>()</em></strong></code><p>Class summary.</p>
<p>Class long description.</p>
<section class="attributes">
<h2>Attributes</h2>
<table class="autosummary">
<tbody>
<tr>
<td>
<a href="_A.attr"><code>attr</code></a>
</td>
<td>
Attribute summary.
</td>
</tr>
</tbody>
</table>
</section><section class="functions">
<h2>Methods</h2>
<table class="autosummary">
<tbody>
<tr>
<td>
<a href="_A.method"><code>method</code></a>(a, b[, c, *args, **kwargs])
</td>
<td>
Method summary, may contain [links](target).
</td>
</tr>
</tbody>
</table>
</section>"""

    _assert_html_equal(result, expected)


def test_document_version() -> None:
    result = _html.document(pd)
    expected = f"""<div class="package-version">v{pd.__version__}</div><h1>pandas</h1>"""

    assert result.startswith(expected)


@pytest.mark.parametrize(
    ("target", "from_obj", "expected"),
    [
        # *From* a module
        ("Series", pd, "pandas.Series"),
        # A package
        ("os", pd.read_csv, "os"),
        ("pandas", pd.read_csv, "pandas"),
        # A sub-module
        ("pandas.io", pd.read_csv, "pandas.io"),
        # A sub-module, implicitly relative to `from_obj`'s package
        ("api", pd.read_csv, "pandas.api"),
        # This is a bit ambiguous, but we have to assume that the user is referring to the stdlib...
        # TODO: Maybe we lost some info here when going from rst to markdown...
        #       So maybe we want to parse links before converting to markdown?
        ("io", pd.read_csv, "io"),
        # A fully qualified name to a class, function, or instance
        ("os.PathLike", pd.read_csv, "os.PathLike"),
        ("os.path.split", pd.read_csv, "os.path.split"),
        ("os.path.sep", pd.read_csv, "os.path.sep"),
        ("pandas.DataFrame", pd.read_csv, "pandas.DataFrame"),
        # A fully qualified name to a class attribute or method
        ("pandas.DataFrame.to_csv", pd.read_csv, "pandas.DataFrame.to_csv"),
        # A fully qualified name, implicitly relative to `from_obj`'s package
        ("DataFrame", pd.read_csv, "pandas.DataFrame"),
        ("DataFrame.to_csv", pd.read_csv, "pandas.DataFrame.to_csv"),
        ("read_fwf", pd.read_csv, "pandas.read_fwf"),
        # Unresolvable
        ("filepath_or_buffer", pd.read_csv, None),
        ("pd.to_datetime", pd.read_csv, None),
        # Ensure that we can handle linking from a `property`
        ("DataFrame.transpose", pd.read_csv, "pandas.DataFrame.transpose"),
        # Linking from a getset_descriptor
        ("ndarray.base", np.generic.base, "numpy.ndarray.base"),
    ],
)
def test_resolve(target: str, from_obj: Any, expected: Any) -> None:
    """
    Unit test for `_resolve` since it is particularly tricky.
    """
    assert _resolve(target, from_obj) == expected


@pytest.mark.parametrize(
    ("object", "expected"),
    [
        # Does not link item names/types in Arguments section, but does link descriptions.
        (
            _test_getdoc_links_arguments_section,
            _TEST_GETDOC_LINKS_ARGS_SECTION_OUTPUT,
        ),
        # Same as previous but using markdown link format.
        (
            _test_getdoc_md_links_arguments_section,
            _TEST_GETDOC_LINKS_ARGS_SECTION_OUTPUT,
        ),
        # Links items in the list under the See Also section.
        (
            _test_getdoc_links_see_also_section,
            _TEST_GETDOC_LINKS_SEE_ALSO_SECTION_OUTPUT,
        ),
        # Same as previous but using markdown link format.
        (
            _test_getdoc_md_links_see_also_section,
            _TEST_GETDOC_LINKS_SEE_ALSO_SECTION_OUTPUT,
        ),
        # Highlights code blocks.
        # Inputs and outputs are split into separate html elements.
        (
            _test_getdoc_code_blocks,
            """\
<pre><code class="language-python"><div class="highlight"><pre><span></span><span class="kn">import</span> <span class="nn">pandas</span> <span class="k">as</span> <span class="nn">pd</span>
<span class="n">pd</span><span class="o">.</span><span class="n">DataFrame</span><span class="p">()</span>
</pre></div>
</code></pre>
<pre><code><div class="highlight"><pre><span></span>Empty DataFrame
Columns: []
Index: []
</pre></div>
</code></pre>
""",
        ),
        # Match and replace bare urls
        (
            _test_getdoc_urls,
            """\
<h2>Note</h2>
<p>See <a href="https://url.com">https://url.com</a> for more info</p>
""",
        ),
        # Should not match to markdown URLs
        (
            _test_getdoc_md_urls,
            """\
<h2>Note</h2>
<p>See <a href="https://url.com">url</a> for more info</p>
""",
        ),
    ],
)
def test_getdoc(object: Any, expected: str) -> None:
    html = _getdoc(object)
    assert html == expected
