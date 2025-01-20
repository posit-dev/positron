#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import os
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List, Optional, cast
from unittest.mock import Mock, patch

import pandas as pd
import polars as pl
import pytest

from positron._vendor import cattrs
from positron._vendor.jedi_language_server import jedi_utils
from positron._vendor.lsprotocol.types import (
    ClientCapabilities,
    CodeAction,
    CodeActionContext,
    CodeActionParams,
    CompletionClientCapabilities,
    CompletionClientCapabilitiesCompletionItemType,
    CompletionItem,
    CompletionParams,
    DidCloseTextDocumentParams,
    DocumentHighlight,
    DocumentSymbol,
    DocumentSymbolParams,
    Hover,
    InitializeParams,
    Location,
    MarkupContent,
    MarkupKind,
    ParameterInformation,
    Position,
    Range,
    RenameParams,
    SignatureHelp,
    SignatureInformation,
    SymbolKind,
    TextDocumentClientCapabilities,
    TextDocumentIdentifier,
    TextDocumentItem,
    TextDocumentPositionParams,
    TextEdit,
    WorkspaceEdit,
)
from positron._vendor.pygls.workspace.text_document import TextDocument
from positron.help_comm import ShowHelpTopicParams
from positron.jedi import PositronInterpreter
from positron.positron_jedilsp import (
    HelpTopicParams,
    PositronInitializationOptions,
    PositronJediLanguageServer,
    PositronJediLanguageServerProtocol,
    _clear_diagnostics_debounced,
    _publish_diagnostics,
    _publish_diagnostics_debounced,
    positron_code_action,
    positron_completion,
    positron_completion_item_resolve,
    positron_definition,
    positron_did_close_diagnostics,
    positron_document_symbol,
    positron_help_topic_request,
    positron_highlight,
    positron_hover,
    positron_references,
    positron_rename,
    positron_signature_help,
    positron_type_definition,
)

from .lsp_data.func import func

LSP_DATA_DIR = Path(__file__).parent / "lsp_data"
TEST_DOCUMENT_URI = "file:///foo.py"

if TYPE_CHECKING:
    from threading import Timer

if TYPE_CHECKING:
    from threading import Timer


@pytest.fixture(autouse=True)
def _reduce_debounce_time(monkeypatch):
    """Reduce the debounce time for diagnostics to be published to speed up tests."""
    monkeypatch.setattr(_clear_diagnostics_debounced, "interval_s", 0.05)
    monkeypatch.setattr(_publish_diagnostics_debounced, "interval_s", 0.05)


def create_server(
    namespace: Optional[Dict[str, Any]] = None,
    root_path: Optional[Path] = None,
    notebook_path: Optional[Path] = None,
) -> PositronJediLanguageServer:
    # Create a server.
    server = PositronJediLanguageServer(
        name="test-server",
        version="0.0.0test",
        protocol_cls=PositronJediLanguageServerProtocol,
    )

    # Initialize the server.
    server.lsp.lsp_initialize(
        InitializeParams(
            capabilities=ClientCapabilities(
                text_document=TextDocumentClientCapabilities(
                    completion=CompletionClientCapabilities(
                        completion_item=CompletionClientCapabilitiesCompletionItemType(
                            # We test markdown docs exclusively.
                            documentation_format=[MarkupKind.Markdown]
                        ),
                    )
                )
            ),
            # Optionally set the root path. This seems to only change file completions.
            root_path=str(root_path) if root_path else None,
            initialization_options={
                # Pass Positron-specific initialization options in serialized format
                # to test deserialization too.
                "positron": cattrs.unstructure(
                    PositronInitializationOptions(
                        notebook_path=notebook_path,
                    )
                ),
            },
        )
    )

    # Mock the shell, since we only really care about the user's namespace.
    server.shell = Mock()
    server.shell.user_ns = {} if namespace is None else namespace

    return server


def create_text_document(server: PositronJediLanguageServer, uri: str, source: str):
    server.workspace.put_text_document(TextDocumentItem(uri, "python", 0, source))
    return server.workspace.text_documents[uri]


@pytest.mark.parametrize(
    ("source", "namespace", "expected_topic"),
    [
        # An unknown variable should not be resolved.
        # ("x", {}, None),
        # ... but a variable in the user's namespace should resolve.
        ("x", {"x": 0}, "builtins.int"),
    ],
)
def test_positron_help_topic_request(
    source: str,
    namespace: Dict[str, Any],
    expected_topic: Optional[str],
) -> None:
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

    params = HelpTopicParams(TextDocumentIdentifier(text_document.uri), Position(0, 0))
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


def _end_of_document(text_document: TextDocument, character: Optional[int] = None) -> Position:
    line = len(text_document.lines) - 1
    if character is None:
        character = len(text_document.lines[line])
    elif character < 0:
        character = len(text_document.lines[line]) + character
    return Position(line, character)


def _completions(
    server: PositronJediLanguageServer,
    text_document: TextDocument,
    character: Optional[int] = None,
) -> List[CompletionItem]:
    params = CompletionParams(
        TextDocumentIdentifier(text_document.uri),
        _end_of_document(text_document, character),
    )
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
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)
    completions = _completions(server, text_document)
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
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)
    completions = _completions(server, text_document)
    completion_labels = [completion.label for completion in completions]
    assert expected_label in completion_labels


def assert_has_path_completion(
    source: str,
    expected_completion: str,
    chars_from_end=1,
    root_path: Optional[Path] = None,
    notebook_path: Optional[Path] = None,
):
    # Replace separators for testing cross-platform.
    source = source.replace("/", os.path.sep)
    expected_completion = expected_completion.replace("/", os.path.sep)

    server = create_server(root_path=root_path, notebook_path=notebook_path)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)
    character = len(source) - chars_from_end
    completions = _completions(server, text_document, character)

    assert len(completions) == 1

    expected_position = Position(0, character)
    assert completions[0].text_edit == TextEdit(
        Range(expected_position, expected_position), expected_completion
    )


def test_path_completion(tmp_path) -> None:
    # See https://github.com/posit-dev/positron/issues/5193.

    dir_ = tmp_path / "my-notebooks.new"
    dir_.mkdir()

    file = dir_ / "weather-report.ipynb"
    file.write_text("")

    _assert_has_path_completion = partial(assert_has_path_completion, root_path=tmp_path)

    # Check directory completions at various points around symbols.
    _assert_has_path_completion('""', "my-notebooks.new/")
    # Quotes aren't automatically closed for directories, since the user may want a file.
    _assert_has_path_completion('"', "my-notebooks.new/", 0)
    _assert_has_path_completion('"my"', "-notebooks.new/")
    _assert_has_path_completion('"my-notebooks"', ".new/")
    _assert_has_path_completion('"my-notebooks."', "new/")
    _assert_has_path_completion('"my-notebooks.new"', "/")

    # Check file completions at various points around symbols.
    _assert_has_path_completion('"my-notebooks.new/"', "weather-report.ipynb")
    # Quotes are automatically closed for files, since they end the completion.
    _assert_has_path_completion('"my-notebooks.new/', 'weather-report.ipynb"', 0)
    _assert_has_path_completion('"my-notebooks.new/weather"', "-report.ipynb")
    _assert_has_path_completion('"my-notebooks.new/weather-report"', ".ipynb")
    _assert_has_path_completion('"my-notebooks.new/weather-report."', "ipynb")
    _assert_has_path_completion('"my-notebooks.new/weather-report.ipynb"', "")


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

    server = create_server(namespace)
    params = CompletionItem(label="label")

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
                    "SyntaxError: invalid syntax (TEST_DOCUMENT_URI, line 1)"
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
        # No errors for help commands.
        ("?str", []),
        ("??str.join", []),
        ("2?", []),
        ("object??  ", []),
    ],
)
def test_publish_diagnostics(source: str, messages: List[str]):
    server = create_server()
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

    with patch.object(server, "publish_diagnostics") as mock:
        _publish_diagnostics(server, text_document.uri)

        [actual_uri, actual_diagnostics] = mock.call_args.args
        actual_messages = [diagnostic.message for diagnostic in actual_diagnostics]
        assert actual_uri == text_document.uri
        assert actual_messages == messages


def test_close_notebook_cell_clears_diagnostics():
    # See: https://github.com/posit-dev/positron/issues/4160
    server = create_server()
    source = """\
---
echo: false
---
"""
    text_document = create_text_document(
        server, "vscode-notebook-cell://foo.ipynb#W0sZmlsZQ%3D%3D", source
    )

    with patch.object(server, "publish_diagnostics") as mock:
        params = DidCloseTextDocumentParams(TextDocumentIdentifier(text_document.uri))
        positron_did_close_diagnostics(server, params)

        # Wait for the diagnostics to be published
        mock.assert_not_called()
        timers: List[Timer] = list(_clear_diagnostics_debounced.timers.values())  # type: ignore
        for timer in timers:
            timer.join()
        mock.assert_called_once_with(params.text_document.uri, [])


def test_notebook_path_completions(tmp_path):
    # Notebook path completions should be in the notebook's parent, not root path.
    # See: https://github.com/posit-dev/positron/issues/5948
    notebook_parent = tmp_path / "notebooks"
    notebook_parent.mkdir()

    notebook_path = notebook_parent / "notebook.ipynb"

    # Create a file in the notebook's parent.
    file_to_complete = notebook_parent / "data.csv"
    file_to_complete.write_text("")

    assert_has_path_completion(
        '""', file_to_complete.name, root_path=tmp_path, notebook_path=notebook_path
    )


# Make a function with parameters to test signature help.
# Create it via exec() so we can reuse the strings in the test.
_func_params = ["x=1", "y=1"]
_func_label = f"def func({', '.join(_func_params)})"
_func_doc = "A function with parameters."
_func_str = f'''\
{_func_label}:
    """
    {_func_doc}
    """
    pass'''


# TODO: Maybe better to write a module to file to test these.
#       Or actually to just have a test module that I import...
# Signature help should work when the object is defined in source or the user's namespace.
# See: https://github.com/posit-dev/positron/issues/5739.
@pytest.mark.parametrize(
    ("source", "namespace"),
    [
        pytest.param(
            f"{_func_str}\nfunc(",
            {},
            id="from_source",
        ),
        pytest.param(
            "func(",
            {"func": func},
            id="from_namespace",
        ),
    ],
)
def test_positron_signature_help(source: str, namespace: Dict[str, Any]) -> None:
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)
    params = TextDocumentPositionParams(
        TextDocumentIdentifier(text_document.uri), _end_of_document(text_document)
    )

    signature_help = positron_signature_help(server, params)

    assert signature_help == SignatureHelp(
        signatures=[
            SignatureInformation(
                label=_func_label,
                documentation=MarkupContent(
                    MarkupKind.Markdown,
                    f"```text\n{_func_doc}\n```",
                ),
                parameters=[ParameterInformation(label=label) for label in _func_params],
            )
        ],
        active_parameter=0,
        active_signature=0,
    )


@pytest.mark.parametrize(
    ("source", "namespace", "expected_location"),
    [
        pytest.param(
            f"{_func_str}\nfunc",
            {},
            Location(
                uri=TEST_DOCUMENT_URI,
                range=Range(start=Position(0, 4), end=Position(0, 8)),
            ),
            id="from_source",
        ),
        pytest.param(
            "_func",
            {"_func": func},
            Location(
                uri=(LSP_DATA_DIR / "func.py").as_uri(),
                range=Range(start=Position(7, 0), end=Position(7, 0)),
            ),
            id="from_namespace",
        ),
    ],
)
def test_positron_definition(
    source: str, namespace: Dict[str, Any], expected_location: Location
) -> None:
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)
    position = _end_of_document(text_document)
    params = TextDocumentPositionParams(TextDocumentIdentifier(text_document.uri), position)

    definition = positron_definition(server, params)

    assert definition == [expected_location]


# # TODO: Maybe need to write a module to file to test this...
# @pytest.mark.parametrize(
#     ("source", "namespace"),
#     [
#         pytest.param(
#             "class Type: pass\ny = Type()\ny",
#             {},
#             id="from_source",
#         ),
#         pytest.param(
#             "class Type: pass\ny = Type()\ny",
#             {},
#             id="from_source",
#         ),
#     ],
# )
# def test_positron_type_definition(source, namespace):
#     server = create_server(namespace)
#     text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

#     params = TextDocumentPositionParams(
#         TextDocumentIdentifier(text_document.uri), _end_of_document(text_document)
#     )

#     type_definition = positron_type_definition(server, params)

#     assert type_definition == [
#         Location(
#             uri=text_document.uri,
#             range=Range(
#                 start=Position(0, 6),
#                 end=Position(0, 10),
#             ),
#         )
#     ]


# @pytest.mark.parametrize(
#     ("source", "namespace", "position", "expected_highlights"),
#     [
#         (
#             "x = 1\nx",
#             {},
#             Position(1, 0),
#             [
#                 DocumentHighlight(range=Range(start=Position(0, 0), end=Position(0, 1))),
#                 DocumentHighlight(range=Range(start=Position(1, 0), end=Position(1, 1))),
#             ],
#         ),
#     ],
# )
# def test_positron_highlight(source, namespace, position, expected_highlights):
#     server = create_server(namespace)
#     text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

#     params = TextDocumentPositionParams(TextDocumentIdentifier(text_document.uri), position)

#     highlights = positron_highlight(server, params)

#     assert highlights == expected_highlights


# # Hover should work when the object is defined in source or the user's namespace.
# # See: https://github.com/posit-dev/positron/issues/5739.
# @pytest.mark.parametrize(
#     ("source", "namespace"),
#     [
#         pytest.param(
#             f"{_func_str}\n_func",
#             {},
#             id="from_source",
#         ),
#         pytest.param(
#             "_func",
#             {"_func": _func},
#             id="from_namespace",
#         ),
#     ],
# )
# def test_positron_hover(source: str, namespace: Dict[str, Any]) -> None:
#     file = Path("foo.py").absolute()
#     server = create_server(namespace)
#     text_document = create_text_document(server, file.as_uri(), source)

#     position = _end_of_document(text_document)
#     params = TextDocumentPositionParams(TextDocumentIdentifier(text_document.uri), position)

#     hover = positron_hover(server, params)

#     assert hover == Hover(
#         contents=MarkupContent(
#             kind=MarkupKind.Markdown,
#             value=f"""\
# ```python
# {_func_label}
# ```
# ---
# ```text
# {_func_doc}
# ```
# **Full name:** `{file.stem}._func`""",
#         ),
#         range=Range(start=Position(position.line, 0), end=position),
#     )


# @pytest.mark.parametrize(
#     ("source", "namespace", "expected_references"),
#     [
#         (
#             "x = 1\nx",
#             {},
#             [Location(uri=TEST_DOCUMENT_URI, range=Range(start=Position(1, 0), end=Position(1, 1)))],
#         ),
#         (
#             "def foo():\n    pass\nfoo()",
#             {},
#             [Location(uri=TEST_DOCUMENT_URI, range=Range(start=Position(2, 0), end=Position(2, 3)))],
#         ),
#     ],
# )
# def test_positron_references(
#     source: str, namespace: Dict[str, Any], expected_references: List[Location]
# ) -> None:
#     server = create_server(namespace)
#     text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

#     params = TextDocumentPositionParams(TextDocumentIdentifier(text_document.uri), Position(1, 0))

#     references = positron_references(server, params)

#     assert references == expected_references


# @pytest.mark.parametrize(
#     ("source", "namespace", "expected_symbols"),
#     [
#         (
#             "def foo():\n    pass",
#             {},
#             [
#                 DocumentSymbol(
#                     name="foo",
#                     kind=SymbolKind.Function,
#                     range=Range(start=Position(0, 0), end=Position(1, 8)),
#                     selection_range=Range(start=Position(0, 4), end=Position(0, 7)),
#                 )
#             ],
#         ),
#         (
#             "class Bar:\n    def baz(self):\n        pass",
#             {},
#             [
#                 DocumentSymbol(
#                     name="Bar",
#                     kind=SymbolKind.Class,
#                     range=Range(start=Position(0, 0), end=Position(2, 12)),
#                     selection_range=Range(start=Position(0, 6), end=Position(0, 9)),
#                     children=[
#                         DocumentSymbol(
#                             name="baz",
#                             kind=SymbolKind.Method,
#                             range=Range(start=Position(1, 4), end=Position(2, 12)),
#                             selection_range=Range(start=Position(1, 8), end=Position(1, 11)),
#                         )
#                     ],
#                 )
#             ],
#         ),
#     ],
# )
# def test_positron_document_symbol(
#     source: str, namespace: Dict[str, Any], expected_symbols: List[DocumentSymbol]
# ) -> None:
#     server = create_server(namespace)
#     text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

#     params = DocumentSymbolParams(text_document=TextDocumentIdentifier(text_document.uri))

#     symbols = positron_document_symbol(server, params)

#     assert symbols == expected_symbols


# @pytest.mark.parametrize(
#     ("source", "namespace", "new_name", "expected_edit"),
#     [
#         (
#             "x = 1\nx",
#             {},
#             "y",
#             WorkspaceEdit(
#                 changes={
#                     TEST_DOCUMENT_URI: [
#                         TextEdit(
#                             range=Range(start=Position(1, 0), end=Position(1, 1)), new_text="y"
#                         )
#                     ]
#                 }
#             ),
#         ),
#         (
#             "def foo():\n    pass\nfoo()",
#             {},
#             "bar",
#             WorkspaceEdit(
#                 changes={
#                     TEST_DOCUMENT_URI: [
#                         TextEdit(
#                             range=Range(start=Position(2, 0), end=Position(2, 3)),
#                             new_text="bar",
#                         )
#                     ]
#                 }
#             ),
#         ),
#     ],
# )
# def test_positron_rename(
#     source: str, namespace: Dict[str, Any], new_name: str, expected_edit: WorkspaceEdit
# ) -> None:
#     server = create_server(namespace)
#     text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

#     params = RenameParams(
#         text_document=TextDocumentIdentifier(text_document.uri),
#         position=Position(1, 0),
#         new_name=new_name,
#     )

#     edit = positron_rename(server, params)

#     assert edit == expected_edit


# @pytest.mark.parametrize(
#     ("source", "namespace", "expected_code_actions"),
#     [
#         ("x = 1\nx", {}, []),
#         ("def foo():\n    pass\nfoo()", {}, []),
#     ],
# )
# def test_positron_code_action(
#     source: str, namespace: Dict[str, Any], expected_code_actions: List[CodeAction]
# ) -> None:
#     server = create_server(namespace)
#     text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

#     params = CodeActionParams(
#         text_document=TextDocumentIdentifier(text_document.uri),
#         range=Range(start=Position(1, 0), end=Position(1, 1)),
#         context=CodeActionContext(
#             diagnostics=[],
#         ),
#     )

#     code_actions = positron_code_action(server, params)

#     assert code_actions == expected_code_actions
