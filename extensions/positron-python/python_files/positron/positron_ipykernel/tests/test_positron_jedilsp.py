#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import os
from threading import Timer
from typing import Any, Dict, List, Optional, cast
from unittest.mock import Mock

import pandas as pd
import polars as pl
import pytest

from positron_ipykernel._vendor.jedi import Project
from positron_ipykernel._vendor.jedi_language_server import jedi_utils
from positron_ipykernel._vendor.lsprotocol.types import (
    CompletionItem,
    CompletionParams,
    DidCloseTextDocumentParams,
    MarkupContent,
    MarkupKind,
    Position,
    Range,
    TextDocumentIdentifier,
    TextEdit,
)
from positron_ipykernel._vendor.pygls.workspace.text_document import TextDocument
from positron_ipykernel.help_comm import ShowHelpTopicParams
from positron_ipykernel.jedi import PositronInterpreter
from positron_ipykernel.positron_jedilsp import (
    HelpTopicParams,
    _clear_diagnostics_debounced,
    _publish_diagnostics,
    _publish_diagnostics_debounced,
    positron_completion,
    positron_completion_item_resolve,
    positron_did_close_diagnostics,
    positron_help_topic_request,
)


@pytest.fixture(autouse=True)
def _reduce_debounce_time(monkeypatch):
    """
    Reduce the debounce time for diagnostics to be published to speed up tests.
    """
    monkeypatch.setattr(_clear_diagnostics_debounced, "interval_s", 0.05)
    monkeypatch.setattr(_publish_diagnostics_debounced, "interval_s", 0.05)


def mock_server(uri: str, source: str, namespace: Dict[str, Any]) -> Mock:
    """
    Minimum interface for a pylgs server to support LSP unit tests.
    """
    server = Mock()
    server.client_capabilities.text_document.completion.completion_item.documentation_format = list(
        MarkupKind
    )
    server.initialization_options.completion.disable_snippets = False
    server.initialization_options.completion.resolve_eagerly = False
    server.initialization_options.completion.ignore_patterns = []
    server.initialization_options.markup_kind_preferred = MarkupKind.Markdown
    server.shell.user_ns = namespace
    server.project = Project("")

    document = TextDocument(uri, source)
    documents = {uri: document}
    server.workspace.documents = documents
    server.workspace.get_document = lambda uri: documents[uri]
    server.workspace.get_text_document = lambda uri: documents[uri]

    return server


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
    source: str,
    namespace: Dict[str, Any],
    expected_topic: Optional[str],
) -> None:
    params = HelpTopicParams(TextDocumentIdentifier("file:///foo.py"), Position(0, 0))
    server = mock_server(params.text_document.uri, source, namespace)

    topic = positron_help_topic_request(server, params)

    if expected_topic is None:
        assert topic is None
    else:
        assert topic == ShowHelpTopicParams(topic=expected_topic)


class _ObjectWithProperty:
    @property
    def prop(self) -> str:
        return "prop"


_object_with_property = _ObjectWithProperty()


def _completions(
    source: str,
    namespace: Dict[str, Any],
    character: Optional[int] = None,
) -> List[CompletionItem]:
    lines = source.splitlines()
    line = len(lines) - 1
    if character is None:
        character = len(lines[line])
    params = CompletionParams(TextDocumentIdentifier("file:///foo.py"), Position(line, character))
    server = mock_server(params.text_document.uri, source, namespace)

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
    source: str,
    namespace: Dict[str, Any],
    expected_labels: List[str],
) -> None:
    completions = _completions(source, namespace)
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
    source: str,
    namespace: Dict[str, Any],
    expected_label: str,
) -> None:
    completions = _completions(source, namespace)
    completion_labels = [completion.label for completion in completions]
    assert expected_label in completion_labels


def test_path_completion(tmp_path) -> None:
    # See https://github.com/posit-dev/positron/issues/5193.

    dir_ = tmp_path / "my-notebooks.new"
    dir_.mkdir()

    file = dir_ / "weather-report.ipynb"
    file.write_text("")

    cwd = os.getcwd()

    def assert_has_path_completion(source: str, completion: str, chars_from_end=1):
        chars_from_end = len(source) - chars_from_end
        cursor = Position(0, chars_from_end)
        completions = _completions(source, {}, cursor.character)
        assert len(completions) == 1
        assert completions[0].text_edit == TextEdit(Range(cursor, cursor), completion)

    try:
        os.chdir(tmp_path)

        # Check directory completions at various points around symbols.
        assert_has_path_completion('""', "my-notebooks.new/")
        # Quotes aren't automatically closed for directories, since the user may want a file.
        assert_has_path_completion('"', "my-notebooks.new/", 0)
        assert_has_path_completion('"my"', "-notebooks.new/")
        assert_has_path_completion('"my-notebooks"', ".new/")
        assert_has_path_completion('"my-notebooks."', "new/")
        assert_has_path_completion('"my-notebooks.new"', "/")

        # Check file completions at various points around symbols.
        assert_has_path_completion('"my-notebooks.new/"', "weather-report.ipynb")
        # Quotes are automatically closed for files, since they end the completion.
        assert_has_path_completion('"my-notebooks.new/', 'weather-report.ipynb"', 0)
        assert_has_path_completion('"my-notebooks.new/weather"', "-report.ipynb")
        assert_has_path_completion('"my-notebooks.new/weather-report"', ".ipynb")
        assert_has_path_completion('"my-notebooks.new/weather-report."', "ipynb")
        assert_has_path_completion('"my-notebooks.new/weather-report.ipynb"', "")
    finally:
        os.chdir(cwd)


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

    server = mock_server("", source, namespace)
    params = CompletionItem("label")

    resolved = positron_completion_item_resolve(server, params)

    assert resolved.detail == expected_detail
    assert isinstance(resolved.documentation, MarkupContent)
    assert resolved.documentation.kind == MarkupKind.Markdown
    assert resolved.documentation.value == expected_documentation


@pytest.mark.parametrize(
    ("source", "messages"),
    [
        # Simple case with no errors.
        ("1 + 1", []),
        # Simple case with a syntax error.
        (
            "1 +",
            [
                (
                    "SyntaxError: invalid syntax (file:///foo.py, line 1)"
                    if os.name == "nt"
                    else "SyntaxError: invalid syntax (foo.py, line 1)"
                )
            ],
        ),
        # No errors for magic commands.
        (r"%ls", []),
        (r"%%bash", []),
        # No errors for shell commands.
        ("!ls", []),
        ("?str", []),
        ("??str.join", []),
        ("2?", []),
        ("object??  ", []),
    ],
)
def test_publish_diagnostics(source: str, messages: List[str]):
    filename = "foo.py"
    uri = f"file:///{filename}"
    server = mock_server(uri, source, {})

    _publish_diagnostics(server, uri)

    [actual_uri, actual_diagnostics] = server.publish_diagnostics.call_args.args
    actual_messages = [diagnostic.message for diagnostic in actual_diagnostics]
    assert actual_uri == uri
    assert actual_messages == messages


def test_close_notebook_cell_clears_diagnostics():
    # See: https://github.com/posit-dev/positron/issues/4160
    code = """\
---
echo: false
---
"""
    params = DidCloseTextDocumentParams(
        TextDocumentIdentifier("vscode-notebook-cell:/foo.ipynb#W0sZmlsZQ%3D%3D")
    )
    server = mock_server(params.text_document.uri, code, {})

    positron_did_close_diagnostics(server, params)

    # Wait for the diagnostics to be published
    server.publish_diagnostics.assert_not_called()
    timers: List[Timer] = list(_clear_diagnostics_debounced.timers.values())  # type: ignore
    for timer in timers:
        timer.join()
    server.publish_diagnostics.assert_called_once_with(params.text_document.uri, [])
