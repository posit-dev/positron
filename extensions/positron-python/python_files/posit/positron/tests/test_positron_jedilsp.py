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
    SymbolInformation,
    SymbolKind,
    TextDocumentClientCapabilities,
    TextDocumentEdit,
    TextDocumentIdentifier,
    TextDocumentItem,
    TextDocumentPositionParams,
    TextEdit,
)
from positron._vendor.pygls.uris import from_fs_path
from positron._vendor.pygls.workspace.text_document import TextDocument
from positron.help_comm import ShowHelpTopicParams
from positron.positron_jedilsp import (
    HelpTopicParams,
    PositronInitializationOptions,
    PositronJediLanguageServer,
    PositronJediLanguageServerProtocol,
    _clear_diagnostics_debounced,
    _MagicType,
    _publish_diagnostics,
    _publish_diagnostics_debounced,
    positron_completion,
    positron_completion_item_resolve,
    positron_declaration,
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
from positron.utils import get_qualname

from .lsp_data.func import func
from .lsp_data.type import Type

if TYPE_CHECKING:
    from threading import Timer


LSP_DATA_DIR = Path(__file__).parent / "lsp_data"
TEST_DOCUMENT_PATH = Path("foo.py")
# Use `from_fs_path` to ensure the same URI format as used by the server.
TEST_DOCUMENT_URI = from_fs_path(str(TEST_DOCUMENT_PATH))


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
    server.shell.magics_manager.lsmagic.return_value = {
        _MagicType.cell: {},
        _MagicType.line: {},
    }

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
    ("source", "namespace", "character", "expected_labels"),
    [
        pytest.param(
            'x["', {"x": {"a": _object_with_property.prop}}, None, ['a"'], id="dict_key_to_property"
        ),
        pytest.param(
            'x = {"a": 0}\nx["',
            {},
            None,
            ['a"'],
            id="source_dict_key_to_int",
        ),
        # When completions match a variable defined in the source _and_ a variable in the user's namespace,
        # prefer the namespace variable.
        pytest.param(
            'x = {"a": 0}\nx["', {"x": {"b": 0}}, None, ['b"'], id="prefer_namespace_over_source"
        ),
        pytest.param('x["', {"x": {"a": 0}}, None, ['a"'], id="dict_key_to_int"),
        pytest.param('{"a": 0}["', {}, None, ['a"'], id="dict_literal_key_to_int"),
        pytest.param(
            'x["',
            {"x": pd.DataFrame({"a": []})},
            None,
            ['a"'],
            id="pandas_dataframe_string_dict_key",
        ),
        pytest.param(
            "x[",
            {"x": pd.DataFrame({0: []})},
            None,
            ["0"],
            id="pandas_dataframe_int_dict_key",
            marks=pytest.mark.skip(reason="Completing integer dict keys not supported"),
        ),
        pytest.param(
            'x["', {"x": pd.Series({"a": 0})}, None, ['a"'], id="pandas_series_string_dict_key"
        ),
        pytest.param(
            'x["', {"x": pl.DataFrame({"a": []})}, None, ['a"'], id="polars_dataframe_dict_key"
        ),
        pytest.param(
            "x[",
            {"x": pl.Series([0])},
            None,
            ["0"],
            id="polars_series_dict_key",
            marks=pytest.mark.skip(reason="Completing integer dict keys not supported"),
        ),
    ],
)
def test_positron_completion_exact(
    source: str,
    namespace: Dict[str, Any],
    character: Optional[int],
    expected_labels: List[str],
) -> None:
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)
    completions = _completions(server, text_document, character)
    completion_labels = [
        completion.text_edit.new_text if completion.text_edit else completion.insert_text
        for completion in completions
    ]
    assert completion_labels == expected_labels


def test_parameter_completions_appear_first() -> None:
    server = create_server()
    text_document = create_text_document(
        server,
        TEST_DOCUMENT_URI,
        """\
def f(x): pass
f(""",
    )
    completions = sorted(_completions(server, text_document), key=lambda c: c.sort_text or c.label)
    completion_labels = [completion.label for completion in completions]
    assert "x=" in completion_labels
    assert completion_labels[0] == "x="


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
        pytest.param(
            'x["',
            {"x": {"a": _object_with_property.prop}},
            "instance str(object='', /) -> str",
            jedi_utils.convert_docstring(cast(str, str.__doc__), MarkupKind.Markdown),
            id="dict_key_to_property",
        ),
        pytest.param(
            'x["',
            {"x": {"a": 0}},
            "instance int(x=None, /) -> int",
            jedi_utils.convert_docstring(cast(str, int.__doc__), MarkupKind.Markdown),
            id="dict_key_to_int",
        ),
        pytest.param(
            "x",
            {"x": 0},
            "instance int(x=None, /) -> int",
            jedi_utils.convert_docstring(cast(str, int.__doc__), MarkupKind.Markdown),
            id="int",
        ),
        pytest.param(
            '{"a": 0}["',
            {},
            "instance int(x=None, /) -> int",
            jedi_utils.convert_docstring(cast(str, int.__doc__), MarkupKind.Markdown),
            id="dict_literal_key_to_int",
        ),
        pytest.param(
            "x",
            {"x": _pd_df},
            f"DataFrame [{_pd_df.shape[0]}x{_pd_df.shape[1]}]",
            f"```text\n{str(_pd_df).strip()}\n```",
            id="pandas_dataframe",
        ),
        pytest.param(
            'x["',
            {"x": _pd_df},
            f"int64 [{_pd_df['a'].shape[0]}]",
            f"```text\n{str(_pd_df['a']).strip()}\n```",
            id="pandas_dataframe_dict_key",
        ),
        pytest.param(
            "x",
            {"x": _pd_df["a"]},
            f"int64 [{_pd_df['a'].shape[0]}]",
            f"```text\n{str(_pd_df['a']).strip()}\n```",
            id="pandas_series",
        ),
        pytest.param(
            "x",
            {"x": _pl_df},
            f"DataFrame [{_pl_df.shape[0]}x{_pl_df.shape[1]}]",
            f"```text\n{str(_pl_df).strip()}\n```",
            id="polars_dataframe",
        ),
        pytest.param(
            'x["',
            {"x": _pl_df},
            f"Int64 [{_pl_df['a'].shape[0]}]",
            f"```text\n{str(_pl_df['a']).strip()}\n```",
            id="polars_dataframe_dict_key",
        ),
        pytest.param(
            "x",
            {"x": _pl_df["a"]},
            f"Int64 [{_pl_df['a'].shape[0]}]",
            f"```text\n{str(_pl_df['a']).strip()}\n```",
            id="polars_series",
        ),
    ],
)
def test_positron_completion_item_resolve(
    source: str,
    namespace: Dict[str, Any],
    expected_detail: str,
    expected_documentation: str,
) -> None:
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

    # Perform an initial completions request.
    # Resolving a completion requires the completion to be in the server's completions cache.
    [params] = _completions(server, text_document)

    # Resolve the completion.
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
                    f"SyntaxError: invalid syntax ({TEST_DOCUMENT_URI}, line 1)"
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
def test_publish_diagnostics(source: str, messages: List[str]) -> None:
    server = create_server()
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

    with patch.object(server, "publish_diagnostics") as mock:
        _publish_diagnostics(server, text_document.uri)

        [actual_uri, actual_diagnostics] = mock.call_args.args
        actual_messages = [diagnostic.message for diagnostic in actual_diagnostics]
        assert actual_uri == text_document.uri
        assert actual_messages == messages


def test_close_notebook_cell_clears_diagnostics() -> None:
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


def test_notebook_path_completions(tmp_path) -> None:
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
_func_name = "func"
_func_params = ["x=1", "y=1"]
_func_label = f"def {_func_name}({', '.join(_func_params)})"
_func_doc = "A function with parameters."
_func_str = f'''\
{_func_label}:
    """
    {_func_doc}
    """
    pass'''


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
                range=Range(start=Position(6, 4), end=Position(6, 9)),
            ),
            id="from_namespace",
        ),
    ],
)
def test_positron_declaration(
    source: str, namespace: Dict[str, Any], expected_location: Location
) -> None:
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)
    position = _end_of_document(text_document)
    params = TextDocumentPositionParams(TextDocumentIdentifier(text_document.uri), position)

    definition = positron_declaration(server, params)

    assert definition == [expected_location]


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
                # TODO: Not sure why this ends at character 9 but previous ends at 8?
                range=Range(start=Position(6, 4), end=Position(6, 9)),
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


@pytest.mark.parametrize(
    ("source", "namespace", "expected_location"),
    [
        pytest.param(
            "class Type: pass\ny = Type()\ny",
            {},
            Location(
                uri=TEST_DOCUMENT_URI,
                range=Range(
                    start=Position(0, 6),
                    end=Position(0, 10),
                ),
            ),
            id="from_source",
        ),
        pytest.param(
            "y = Type()\ny",
            {"Type": Type},
            Location(
                uri=(LSP_DATA_DIR / "type.py").as_uri(),
                range=Range(
                    start=Position(6, 6),
                    end=Position(6, 10),
                ),
            ),
            id="from_namespace",
        ),
    ],
)
def test_positron_type_definition(
    source: str, namespace: Dict[str, Any], expected_location: Location
) -> None:
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

    params = TextDocumentPositionParams(
        TextDocumentIdentifier(text_document.uri), _end_of_document(text_document)
    )

    type_definition = positron_type_definition(server, params)

    assert type_definition == [expected_location]


@pytest.mark.parametrize(
    ("source", "namespace", "position", "expected_highlights"),
    [
        pytest.param(
            "x = 1\nx",
            {},
            Position(1, 0),
            [
                DocumentHighlight(range=Range(start=Position(0, 0), end=Position(0, 1))),
                DocumentHighlight(range=Range(start=Position(1, 0), end=Position(1, 1))),
            ],
            id="assignment",
        ),
    ],
)
def test_positron_highlight(
    source: str,
    namespace: Dict[str, Any],
    position: Position,
    expected_highlights: List[DocumentHighlight],
) -> None:
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

    params = TextDocumentPositionParams(TextDocumentIdentifier(text_document.uri), position)

    highlights = positron_highlight(server, params)

    assert highlights == expected_highlights


@pytest.mark.parametrize(
    ("source", "namespace", "expected_fullname"),
    [
        pytest.param(
            f"{_func_str}\nfunc",
            {},
            # TODO: Ideally, this should be the name of the text document.
            f"__main__.{_func_name}",
            id="from_source",
        ),
        pytest.param(
            "func",
            {"func": func},
            get_qualname(func),
            id="from_namespace",
        ),
    ],
)
def test_positron_hover(source: str, namespace: Dict[str, Any], expected_fullname: str) -> None:
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

    position = _end_of_document(text_document)
    params = TextDocumentPositionParams(TextDocumentIdentifier(text_document.uri), position)

    hover = positron_hover(server, params)

    assert hover == Hover(
        contents=MarkupContent(
            kind=MarkupKind.Markdown,
            value=f"""\
```python
{_func_label}
```
---
```text
{_func_doc}
```
**Full name:** `{expected_fullname}`""",
        ),
        range=Range(start=Position(position.line, 0), end=position),
    )


@pytest.mark.parametrize(
    ("source", "namespace", "expected_references"),
    [
        pytest.param(
            "x = 1\nx",
            {},
            [
                Location(TEST_DOCUMENT_URI, Range(Position(0, 0), Position(0, 1))),
                Location(TEST_DOCUMENT_URI, Range(Position(1, 0), Position(1, 1))),
            ],
            id="assignment",
        ),
        pytest.param(
            "def foo():\n    pass\nfoo",
            {},
            [
                Location(TEST_DOCUMENT_URI, Range(Position(0, 4), Position(0, 7))),
                Location(TEST_DOCUMENT_URI, Range(Position(2, 0), Position(2, 3))),
            ],
            id="function_definition",
        ),
        pytest.param(
            "func",
            {"func": func},
            [
                # TODO: Ideally, this would include `func`'s definition, but seems to be a
                #       limitation of Jedi.
                Location(TEST_DOCUMENT_URI, Range(Position(0, 0), Position(0, 4))),
            ],
            id="from_namespace",
        ),
    ],
)
def test_positron_references(
    source: str, namespace: Dict[str, Any], expected_references: List[Location]
) -> None:
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

    params = TextDocumentPositionParams(
        TextDocumentIdentifier(text_document.uri), _end_of_document(text_document)
    )

    references = positron_references(server, params)

    assert references == expected_references


@pytest.mark.parametrize(
    ("source", "namespace", "expected_symbols"),
    [
        pytest.param(
            "def foo():\n    pass",
            {},
            [
                SymbolInformation(
                    name="foo",
                    kind=SymbolKind.Function,
                    location=Location(
                        TEST_DOCUMENT_URI, Range(start=Position(0, 4), end=Position(0, 7))
                    ),
                    # TODO: Ideally, this should be the name of the text document.
                    container_name="__main__.foo",
                )
            ],
            id="from_source",
        ),
        # Namespace objects are excluded from the document's symbols since they aren't definitions.
        pytest.param(
            "func",
            {"func": func},
            None,
            id="from_namespace",
        ),
    ],
)
def test_positron_document_symbol(
    source: str, namespace: Dict[str, Any], expected_symbols: Optional[List[DocumentSymbol]]
) -> None:
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

    params = DocumentSymbolParams(text_document=TextDocumentIdentifier(text_document.uri))

    symbols = positron_document_symbol(server, params)

    assert symbols == expected_symbols


@pytest.mark.parametrize(
    ("source", "namespace", "new_name", "expected_text_edits"),
    [
        pytest.param(
            "x = 1\nx",
            {},
            "y",
            [
                TextEdit(Range(Position(0, 0), Position(0, 1)), new_text="y"),
                TextEdit(Range(Position(1, 0), Position(1, 1)), new_text="y"),
            ],
            id="assignment",
        ),
        pytest.param(
            "def foo(): pass\nfoo",
            {},
            "bar",
            [
                TextEdit(Range(Position(0, 4), Position(0, 7)), new_text="bar"),
                TextEdit(Range(Position(1, 0), Position(1, 3)), new_text="bar"),
            ],
            id="function",
        ),
    ],
)
def test_positron_rename(
    source: str, namespace: Dict[str, Any], new_name: str, expected_text_edits: List[TextEdit]
) -> None:
    server = create_server(namespace)
    text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

    params = RenameParams(
        text_document=TextDocumentIdentifier(text_document.uri),
        position=_end_of_document(text_document),
        new_name=new_name,
    )

    workspace_edit = positron_rename(server, params)

    assert workspace_edit is not None
    assert workspace_edit.document_changes is not None
    assert len(workspace_edit.document_changes) == 1
    text_document_edit = workspace_edit.document_changes[0]
    assert isinstance(text_document_edit, TextDocumentEdit)
    assert text_document_edit.edits == expected_text_edits
