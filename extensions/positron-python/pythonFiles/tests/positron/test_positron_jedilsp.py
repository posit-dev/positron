from typing import Any, Callable, Dict, List, Optional, cast
from unittest.mock import Mock

import pandas as pd
import polars as pl
import pytest
from IPython.terminal.interactiveshell import TerminalInteractiveShell
from jedi import Project
from jedi_language_server import jedi_utils
from lsprotocol.types import (
    CompletionItem,
    CompletionParams,
    MarkupContent,
    MarkupKind,
    Position,
    TextDocumentIdentifier,
)
from positron.help import ShowHelpTopicParams
from positron.inspectors import get_inspector
from positron.jedi import PositronInterpreter
from positron.positron_ipkernel import PositronIPyKernel
from positron.positron_jedilsp import (
    HelpTopicParams,
    positron_completion,
    positron_completion_item_resolve,
    positron_help_topic_request,
)
from pygls.workspace.text_document import TextDocument


@pytest.fixture
def mock_server(kernel: PositronIPyKernel) -> Callable[[str, str], Mock]:
    """
    Minimum interface for a pylgs server to support LSP unit tests.
    """

    # Return a function that returns a mock server rather than an instantiated mock server,
    # since uri and source change between tests.
    def inner(uri: str, source: str) -> Mock:
        server = Mock()
        server.client_capabilities.text_document.completion.completion_item.documentation_format = (
            list(MarkupKind)
        )
        server.initialization_options.completion.disable_snippets = False
        server.initialization_options.completion.resolve_eagerly = False
        server.initialization_options.completion.ignore_patterns = []
        server.initialization_options.markup_kind_preferred = MarkupKind.Markdown
        server.kernel = kernel
        server.project = Project("")
        server.workspace.get_document.return_value = TextDocument(uri, source)

        return server

    return inner


@pytest.mark.parametrize(
    ("source", "namespace", "expected_topic"),
    [
        # An unknown variable should not be resolved.
        ("x", {}, None),
        # ... but a variable in the user's namespace should resolve.
        ("x", {"x": 0}, "builtins.int"),
    ],
)
def test_positron_help_topic_request(
    mock_server: Callable[[str, str], Mock],
    shell: TerminalInteractiveShell,
    source: str,
    namespace: Dict[str, Any],
    expected_topic: Optional[str],
) -> None:
    shell.user_ns.update(namespace)

    params = HelpTopicParams(TextDocumentIdentifier("file:///foo.py"), Position(0, 0))
    server = mock_server(params.text_document.uri, source)

    topic = positron_help_topic_request(server, params)

    if expected_topic is None:
        assert topic is None
    else:
        assert topic == ShowHelpTopicParams(expected_topic)


class _ObjectWithProperty:
    @property
    def prop(self) -> str:
        return "prop"


_object_with_property = _ObjectWithProperty()


def _completions(
    mock_server: Callable[[str, str], Mock],
    shell: TerminalInteractiveShell,
    source: str,
    namespace: Dict[str, Any],
) -> List[CompletionItem]:
    shell.user_ns.update(namespace)

    lines = source.splitlines()
    line = len(lines) - 1
    character = len(lines[line])
    params = CompletionParams(TextDocumentIdentifier("file:///foo.py"), Position(line, character))
    server = mock_server(params.text_document.uri, source)

    completion_list = positron_completion(server, params)

    assert completion_list is not None, "No completions returned"

    return completion_list.items


@pytest.mark.parametrize(
    ("source", "namespace", "expected_labels"),
    [
        # Dict key mapping to a property.
        ('x["', {"x": {"a": _object_with_property.prop}}, ["a"]),
        # When completions match a variable defined in the source _and_ a variable in the user's namespace,
        # prefer the namespace variable.
        ('x = {"a": 0}\nx["', {"x": {"b": 0}}, ["b"]),
        # Dict key mapping to an int.
        ('x["', {"x": {"a": 0}}, ["a"]),
        # Dict literal key mapping to an int.
        ('{"a": 0}["', {}, ["a"]),
        # Pandas dataframe - dict key access.
        ('x["', {"x": pd.DataFrame({"a": []})}, ["a"]),  # string column name
        ('x["', {"x": pd.DataFrame({0: []})}, ["0"]),  # integer column name
        # Polars dataframe - dict key access.
        ('x["', {"x": pl.DataFrame({"a": []})}, ["a"]),
    ],
)
def test_positron_completion_exact(
    mock_server: Mock,
    shell: TerminalInteractiveShell,
    source: str,
    namespace: Dict[str, Any],
    expected_labels: List[str],
) -> None:
    completions = _completions(mock_server, shell, source, namespace)
    completion_labels = [completion.label for completion in completions]
    assert completion_labels == expected_labels


@pytest.mark.parametrize(
    ("source", "namespace", "expected_label"),
    [
        # Pandas dataframe - attribute access.
        # Note that polars dataframes don't support accessing columns as attributes.
        ("x.a", {"x": pd.DataFrame({"a": []})}, "a"),
    ],
)
def test_positron_completion_contains(
    mock_server: Mock,
    shell: TerminalInteractiveShell,
    source: str,
    namespace: Dict[str, Any],
    expected_label: str,
) -> None:
    completions = _completions(mock_server, shell, source, namespace)
    completion_labels = [completion.label for completion in completions]
    assert expected_label in completion_labels


_pd_df = pd.DataFrame({"a": [0]})
_pl_df = pl.DataFrame({"a": [0]})


@pytest.mark.parametrize(
    ("source", "namespace", "expected_detail", "expected_documentation"),
    [
        # Dict key mapping to a property.
        (
            'x["',
            {"x": {"a": _object_with_property.prop}},
            "instance str(object='', /) -> str",
            jedi_utils.convert_docstring(cast(str, str.__doc__), MarkupKind.Markdown),
        ),
        # Dict key mapping to an int.
        (
            'x["',
            {"x": {"a": 0}},
            "instance int(x=None, /) -> int",
            jedi_utils.convert_docstring(cast(str, int.__doc__), MarkupKind.Markdown),
        ),
        # Integer, to sanity check for a basic value.
        (
            "x",
            {"x": 0},
            "instance int(x=None, /) -> int",
            jedi_utils.convert_docstring(cast(str, int.__doc__), MarkupKind.Markdown),
        ),
        # Dict literal key mapping to an int.
        (
            '{"a": 0}["',
            {},
            "instance int(x=None, /) -> int",
            jedi_utils.convert_docstring(cast(str, int.__doc__), MarkupKind.Markdown),
        ),
        # Pandas dataframe.
        (
            "x",
            {"x": _pd_df},
            f"DataFrame [{_pd_df.shape[0]}x{_pd_df.shape[1]}]",
            f"```text\n{_pd_df}\n```",
        ),
        # Pandas dataframe column - dict key access.
        (
            'x["',
            {"x": _pd_df},
            f"int64 [{_pd_df['a'].shape[0]}]",
            f"```text\n{_pd_df['a']}\n```",
        ),
        # Pandas series.
        (
            "x",
            {"x": _pd_df["a"]},
            f"int64 [{_pd_df['a'].shape[0]}]",
            f"```text\n{_pd_df['a']}\n```",
        ),
        # Polars dataframe.
        (
            "x",
            {"x": _pl_df},
            f"DataFrame [{_pl_df.shape[0]}x{_pl_df.shape[1]}]",
            f"```text\n{_pl_df}\n```",
        ),
        # Polars dataframe column - dict key access.
        (
            'x["',
            {"x": _pl_df},
            f"Int64 [{_pl_df['a'].shape[0]}]",
            f"```text\n{_pl_df['a']}\n```",
        ),
        # Polars series.
        (
            "x",
            {"x": _pl_df["a"]},
            f"Int64 [{_pl_df['a'].shape[0]}]",
            f"```text\n{_pl_df['a']}\n```",
        ),
    ],
)
def test_positron_completion_item_resolve(
    mock_server: Mock,
    source: str,
    namespace: Dict[str, Any],
    expected_detail: str,
    expected_documentation: str,
    monkeypatch,
) -> None:
    # Create a jedi Completion and patch jedi language server's most recent completions.
    # This is the state that we expect to be in when positron_completion_item_resolve is called.
    lines = source.splitlines()
    line = len(lines)
    character = len(lines[line - 1])
    completions = PositronInterpreter(source, namespaces=[namespace]).complete(line, character)
    assert len(completions) == 1, "Test cases must have exactly one completion"
    [completion] = completions
    monkeypatch.setattr(jedi_utils, "_MOST_RECENT_COMPLETIONS", {"label": completion})

    server = mock_server("", source)
    params = CompletionItem("label")

    resolved = positron_completion_item_resolve(server, params)

    assert resolved.detail == expected_detail
    assert isinstance(resolved.documentation, MarkupContent)
    assert resolved.documentation.kind == MarkupKind.Markdown
    assert resolved.documentation.value == expected_documentation
