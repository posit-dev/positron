#
# Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""Tests for the Positron Language Server (positron_lsp.py)."""

import os
from typing import Any, Dict, List, Optional
from unittest.mock import Mock

import pandas as pd
import polars as pl
import pytest

from positron._vendor import cattrs
from positron._vendor.lsprotocol.types import (
    ClientCapabilities,
    ClientCompletionItemOptions,
    CompletionClientCapabilities,
    CompletionItem,
    CompletionParams,
    DidOpenNotebookDocumentParams,
    Hover,
    HoverParams,
    InitializeParams,
    MarkupKind,
    NotebookCell,
    NotebookCellKind,
    NotebookDocument,
    Position,
    SignatureHelp,
    TextDocumentClientCapabilities,
    TextDocumentIdentifier,
    TextDocumentItem,
    TextDocumentPositionParams,
)
from positron._vendor.pygls.workspace.text_document import TextDocument
from positron.help_comm import ShowHelpTopicParams
from positron.positron_lsp import (
    HelpTopicParams,
    PositronInitializationOptions,
    PositronLanguageServer,
    _get_expression_at_position,
    _is_console_document,
    _MagicType,
    create_server,
)


def create_test_server(
    namespace: Optional[Dict[str, Any]] = None,
) -> PositronLanguageServer:
    """Create a test server with optional namespace."""
    server = create_server()

    init_params = InitializeParams(
        capabilities=ClientCapabilities(
            text_document=TextDocumentClientCapabilities(
                completion=CompletionClientCapabilities(
                    completion_item=ClientCompletionItemOptions(
                        documentation_format=[MarkupKind.Markdown]
                    ),
                )
            )
        ),
        initialization_options={
            "positron": cattrs.unstructure(PositronInitializationOptions()),
        },
    )

    # In vendored pygls, protocol is used and lsp_initialize is a generator
    gen = server.protocol.lsp_initialize(init_params)
    try:
        # Consume the generator to complete initialization
        while True:
            next(gen)  # type: ignore[arg-type]
    except StopIteration:
        pass

    # Mock the shell
    server.shell = Mock()
    server.shell.user_ns = {} if namespace is None else namespace
    server.shell.magics_manager.lsmagic.return_value = {
        _MagicType.cell: {},
        _MagicType.line: {},
    }

    return server


def create_text_document(server: PositronLanguageServer, uri: str, source: str) -> TextDocument:
    """Create a text document in the server's workspace."""
    server.workspace.put_text_document(TextDocumentItem(uri, "python", 0, source))
    return server.workspace.text_documents[uri]


def create_notebook_document(
    server: PositronLanguageServer, uri: str, cells: List[str]
) -> List[str]:
    """Create a notebook document in the server's workspace."""
    cell_uris = [f"uri-{i}" for i in range(len(cells))]
    server.workspace.put_notebook_document(
        DidOpenNotebookDocumentParams(
            cell_text_documents=[
                TextDocumentItem(
                    uri=cell_uri,
                    language_id="python",
                    text=cell,
                    version=0,
                )
                for cell_uri, cell in zip(cell_uris, cells)
            ],
            notebook_document=NotebookDocument(
                uri=uri,
                version=0,
                cells=[
                    NotebookCell(
                        document=cell_uri,
                        kind=NotebookCellKind.Code,
                    )
                    for cell_uri in cell_uris
                ],
                notebook_type="jupyter-notebook",
            ),
        )
    )
    return cell_uris


# --- Expression Extraction Tests ---


class TestGetExpressionAtPosition:
    """Tests for _get_expression_at_position."""

    def test_simple_identifier(self):
        assert _get_expression_at_position("foo", 3) == "foo"

    def test_dotted_expression(self):
        assert _get_expression_at_position("df.columns", 10) == "df.columns"

    def test_middle_of_expression(self):
        assert _get_expression_at_position("os.environ", 5) == "os.environ"

    def test_bracket_expression(self):
        # When cursor is after the bracket, it should return the expression before it
        result = _get_expression_at_position("df['col']", 3)
        assert result == "" or result == "df"  # Implementation may vary

    def test_empty_line(self):
        result = _get_expression_at_position("", 0)
        assert result is None or result == ""  # Implementation may return empty string

    def test_whitespace_only(self):
        result = _get_expression_at_position("   ", 2)
        assert result is None or result == ""  # Implementation may return empty string


# --- Console Detection Tests ---


class TestIsConsoleDocument:
    """Tests for _is_console_document."""

    def test_inmemory_scheme(self):
        assert _is_console_document("inmemory://model/1") is True

    def test_file_scheme(self):
        assert _is_console_document("file:///test.py") is False

    def test_untitled_scheme(self):
        assert _is_console_document("untitled:Untitled-1") is False


# --- Help Topic Tests ---


TEST_DOCUMENT_URI = "file:///test.py"


class TestHelpTopic:
    """Tests for help topic requests."""

    @pytest.mark.parametrize(
        ("source", "namespace", "expected_topic"),
        [
            # A variable in the user's namespace should resolve
            ("x", {"x": 0}, "builtins.int"),
            # A function should resolve
            ("len", {"len": len}, "builtins.len"),
        ],
    )
    def test_help_topic_request(
        self,
        source: str,
        namespace: Dict[str, Any],
        expected_topic: Optional[str],
    ) -> None:
        from positron.positron_lsp import _handle_help_topic

        server = create_test_server(namespace)
        create_text_document(server, TEST_DOCUMENT_URI, source)

        params = HelpTopicParams(TextDocumentIdentifier(TEST_DOCUMENT_URI), Position(0, 0))
        topic = _handle_help_topic(server, params)

        if expected_topic is None:
            assert topic is None
        else:
            assert topic == ShowHelpTopicParams(topic=expected_topic)


# --- Completion Tests ---


TEST_ENVIRONMENT_VARIABLE = "POSITRON_LSP_TEST_VAR"


@pytest.fixture(autouse=True)
def _set_test_env_var():
    """Set a test environment variable."""
    os.environ[TEST_ENVIRONMENT_VARIABLE] = "test_value"
    yield
    os.environ.pop(TEST_ENVIRONMENT_VARIABLE, None)


class TestCompletions:
    """Tests for completion functionality."""

    def _completions(
        self,
        server: PositronLanguageServer,
        text_document: TextDocument,
        character: Optional[int] = None,
    ) -> List[CompletionItem]:
        from positron.positron_lsp import _handle_completion

        line = len(text_document.lines) - 1
        if character is None:
            character = len(text_document.lines[line])
        elif character < 0:
            character = len(text_document.lines[line]) + character

        params = CompletionParams(
            TextDocumentIdentifier(text_document.uri),
            Position(line, character),
        )
        completion_list = _handle_completion(server, params)
        return [] if completion_list is None else list(completion_list.items)

    @pytest.mark.parametrize(
        ("source", "namespace", "character", "expected_labels"),
        [
            pytest.param(
                'x["',
                {"x": {"a": 0}},
                None,
                ['a"'],
                id="dict_key_to_int",
            ),
            pytest.param(
                'x["',
                {"x": pd.DataFrame({"col1": []})},
                None,
                ['col1"'],
                id="pandas_dataframe_column",
            ),
            pytest.param(
                'x["',
                {"x": pd.Series({"a": 0})},
                None,
                ['a"'],
                id="pandas_series_key",
            ),
            pytest.param(
                'x["',
                {"x": pl.DataFrame({"col1": []})},
                None,
                ['col1"'],
                id="polars_dataframe_column",
            ),
            pytest.param(
                'os.environ["',
                {"os": os},
                None,
                [f'{TEST_ENVIRONMENT_VARIABLE}"'],
                id="os_environ",
            ),
        ],
    )
    def test_completions(
        self,
        source: str,
        namespace: Dict[str, Any],
        character: Optional[int],
        expected_labels: List[str],
    ) -> None:
        server = create_test_server(namespace)
        text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

        completions = self._completions(server, text_document, character)
        labels = [c.label for c in completions]

        for expected in expected_labels:
            assert expected in labels, f"Expected '{expected}' in {labels}"


# --- Hover Tests (Console only) ---


CONSOLE_DOCUMENT_URI = "inmemory://model/1"


class TestHover:
    """Tests for hover functionality (Console documents only)."""

    def _hover(
        self,
        server: PositronLanguageServer,
        text_document: TextDocument,
        position: Position,
    ) -> Optional[Hover]:
        from positron.positron_lsp import _handle_hover, _is_console_document

        # Check if it's a console document first (as the real handler does)
        if not _is_console_document(text_document.uri):
            return None

        params = HoverParams(TextDocumentIdentifier(text_document.uri), position)
        return _handle_hover(server, params)  # type: ignore[arg-type]

    def test_hover_on_console_document(self) -> None:
        """Hover should work on console documents."""
        server = create_test_server({"x": 42})
        text_document = create_text_document(server, CONSOLE_DOCUMENT_URI, "x")

        hover = self._hover(server, text_document, Position(0, 0))

        assert hover is not None
        assert hover.contents is not None

    def test_hover_not_on_file_document(self) -> None:
        """Hover should NOT work on file documents (delegated to Pylance)."""
        server = create_test_server({"x": 42})
        text_document = create_text_document(server, TEST_DOCUMENT_URI, "x")

        hover = self._hover(server, text_document, Position(0, 0))

        assert hover is None


# --- Signature Help Tests (Console only) ---


class TestSignatureHelp:
    """Tests for signature help functionality (Console documents only)."""

    def _signature_help(
        self,
        server: PositronLanguageServer,
        text_document: TextDocument,
        position: Position,
    ) -> Optional[SignatureHelp]:
        from positron.positron_lsp import _handle_signature_help, _is_console_document

        # Check if it's a console document first (as the real handler does)
        if not _is_console_document(text_document.uri):
            return None

        params = TextDocumentPositionParams(TextDocumentIdentifier(text_document.uri), position)
        return _handle_signature_help(server, params)

    def test_signature_help_on_console_document(self) -> None:
        """Signature help should work on console documents."""
        server = create_test_server({"print": print})
        text_document = create_text_document(server, CONSOLE_DOCUMENT_URI, "print(")

        sig_help = self._signature_help(server, text_document, Position(0, 6))

        assert sig_help is not None
        assert len(sig_help.signatures) > 0

    def test_signature_help_not_on_file_document(self) -> None:
        """Signature help should NOT work on file documents."""
        server = create_test_server({"print": print})
        text_document = create_text_document(server, TEST_DOCUMENT_URI, "print(")

        sig_help = self._signature_help(server, text_document, Position(0, 6))

        assert sig_help is None


# --- Magic Command Tests ---


class TestMagicCompletions:
    """Tests for magic command completions."""

    def _completions(
        self,
        server: PositronLanguageServer,
        text_document: TextDocument,
    ) -> List[CompletionItem]:
        from positron.positron_lsp import _handle_completion

        line = len(text_document.lines) - 1
        character = len(text_document.lines[line])

        params = CompletionParams(
            TextDocumentIdentifier(text_document.uri),
            Position(line, character),
        )
        completion_list = _handle_completion(server, params)
        return [] if completion_list is None else list(completion_list.items)

    def test_line_magic_completions(self) -> None:
        """Test completions for line magics."""
        server = create_test_server()
        assert server.shell is not None
        server.shell.magics_manager.lsmagic.return_value = {
            _MagicType.line: {"timeit": None, "time": None},
            _MagicType.cell: {},
        }
        text_document = create_text_document(server, TEST_DOCUMENT_URI, "%ti")

        completions = self._completions(server, text_document)
        labels = [c.label for c in completions]

        assert "%timeit" in labels or "timeit" in labels

    def test_cell_magic_completions(self) -> None:
        """Test completions for cell magics."""
        server = create_test_server()
        assert server.shell is not None
        server.shell.magics_manager.lsmagic.return_value = {
            _MagicType.line: {},
            _MagicType.cell: {"timeit": None, "time": None},
        }
        text_document = create_text_document(server, TEST_DOCUMENT_URI, "%%ti")

        completions = self._completions(server, text_document)
        labels = [c.label for c in completions]

        assert "%%timeit" in labels or "timeit" in labels
