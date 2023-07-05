import pytest
from typing import Any, Callable, Tuple

from positron.pydoc import _PositronHTMLDoc


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
