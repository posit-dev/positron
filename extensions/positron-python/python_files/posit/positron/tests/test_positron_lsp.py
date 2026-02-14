#
# Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""Tests for the Positron Language Server (positron_lsp.py)."""

import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import Mock, patch

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
    InsertReplaceEdit,
    MarkupContent,
    MarkupKind,
    NotebookCell,
    NotebookCellKind,
    NotebookDocument,
    Position,
    Range,
    SignatureHelp,
    TextDocumentClientCapabilities,
    TextDocumentIdentifier,
    TextDocumentItem,
    TextDocumentPositionParams,
)
from positron._vendor.pygls.workspace.text_document import TextDocument
from positron.help_comm import ShowHelpTopicParams
from positron.positron_lsp import (
    _RE_ATTRIBUTE_ACCESS,
    HelpTopicParams,
    PositronInitializationOptions,
    PositronLanguageServer,
    _get_expression_at_position,
    _parse_os_imports,
    _safe_resolve_expression,
    create_server,
)

TEST_DOCUMENT_URI = "file:///test_document.py"
TEST_ENVIRONMENT_VARIABLE = "POSITRON_LSP_TEST_VAR"


def create_test_server(
    namespace: Optional[Dict[str, Any]] = None,
    root_path: Optional[Path] = None,
    working_directory: Optional[str] = None,
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
        # Optionally set the root path. This seems to only change file completions.
        root_path=str(root_path) if root_path else None,
        initialization_options={
            "positron": cattrs.unstructure(
                PositronInitializationOptions(working_directory=working_directory)
            ),
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
        "cell": {},
        "line": {},
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


class _ObjectWithProperty:
    @property
    def prop(self) -> str:
        return "prop"


object_with_property = _ObjectWithProperty()


# Make a function with parameters to test signature help.
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

# Create the actual function via exec() so we can reuse the strings in the test.
exec(_func_str)
func = locals()[_func_name]


class TestGetExpressionAtPosition:
    """Tests for _get_expression_at_position."""

    def test_simple_identifier(self):
        assert _get_expression_at_position("foo", 3) == "foo"

    def test_dotted_expression(self):
        assert _get_expression_at_position("df.columns", 10) == "df.columns"

    def test_middle_of_expression(self):
        assert _get_expression_at_position("os.environ", 5) == "os.environ"

    def test_bracket_expression(self):
        result = _get_expression_at_position("df['col']", 1)
        assert result == "df"
        result = _get_expression_at_position("df['col']", 3)
        assert result == ""
        result = _get_expression_at_position("df['col']", 5)
        assert result == "col"

    def test_empty_line(self):
        result = _get_expression_at_position("", 0)
        assert result == ""

    def test_whitespace_only(self):
        result = _get_expression_at_position("   ", 2)
        assert result == ""


class TestSafeResolveExpression:
    """Tests for _safe_resolve_expression."""

    def test_simple_name(self):
        namespace = {"x": 42}
        result = _safe_resolve_expression(namespace, "x")
        assert result == 42

    def test_attribute_access(self):
        namespace = {"os": os}
        result = _safe_resolve_expression(namespace, "os.path")
        assert result is os.path

    def test_chained_attributes(self):
        import sys

        namespace = {"sys": sys}
        result = _safe_resolve_expression(namespace, "sys.version_info.major")
        assert result == sys.version_info.major

    def test_subscript_with_string(self):
        namespace = {"d": {"key": "value"}}
        result = _safe_resolve_expression(namespace, "d['key']")
        assert result == "value"

    def test_subscript_with_int(self):
        namespace = {"lst": [10, 20, 30]}
        result = _safe_resolve_expression(namespace, "lst[1]")
        assert result == 20

    def test_dataframe_column(self):
        df = pd.DataFrame({"col1": [1, 2, 3]})
        namespace = {"df": df}
        result = _safe_resolve_expression(namespace, "df['col1']")
        assert pd.Series([1, 2, 3]).equals(result)

    def test_undefined_name(self):
        namespace = {}
        result = _safe_resolve_expression(namespace, "undefined")
        assert result is None

    def test_invalid_syntax(self):
        namespace = {"x": 42}
        result = _safe_resolve_expression(namespace, "x +")
        assert result is None

    def test_rejects_function_calls(self):
        namespace = {"len": len}
        result = _safe_resolve_expression(namespace, "len([1,2,3])")
        assert result is None

    def test_rejects_computed_subscript(self):
        namespace = {"d": {"key": "value"}, "k": "key"}
        result = _safe_resolve_expression(namespace, "d[k]")
        assert result is None

    def test_rejects_import(self):
        namespace = {}
        result = _safe_resolve_expression(namespace, "__import__('os')")
        assert result is None

    def test_empty_expression(self):
        namespace = {"x": 42}
        result = _safe_resolve_expression(namespace, "")
        assert result is None


class TestParseOsImports:
    """Tests for _parse_os_imports."""

    def test_simple_import(self):
        result = _parse_os_imports("import os")
        assert result == {"os": "os"}

    def test_aliased_import(self):
        result = _parse_os_imports("import os as system")
        assert result == {"system": "os"}

    def test_multiple_imports(self):
        result = _parse_os_imports("import sys, os, json")
        assert result == {"os": "os"}

    def test_multiple_imports_with_alias(self):
        result = _parse_os_imports("import sys, os as o, json")
        assert result == {"o": "os"}

    def test_multiline_imports(self):
        result = _parse_os_imports("import sys\nimport os\nimport json")
        assert result == {"os": "os"}

    def test_no_os_import(self):
        result = _parse_os_imports("import sys\nimport json")
        assert result == {}

    def test_invalid_syntax(self):
        # Incomplete syntax should still extract import (robust parsing)
        result = _parse_os_imports('import os; os.environ["')
        assert result == {"os": "os"}

    def test_from_import_not_supported(self):
        # from imports are explicitly not supported
        result = _parse_os_imports("from os import environ")
        assert result == {}

    def test_empty_source(self):
        result = _parse_os_imports("")
        assert result == {}

    def test_whitespace_only(self):
        result = _parse_os_imports("   \n  ")
        assert result == {}


class TestAttributeAccessPattern:
    """Tests for _RE_ATTRIBUTE_ACCESS regex pattern edge cases."""

    def test_simple_attribute(self):
        match = _RE_ATTRIBUTE_ACCESS.search("obj.attr")
        assert match and match.groups() == ("obj", "attr")

    def test_chained_attributes(self):
        match = _RE_ATTRIBUTE_ACCESS.search("a.b.c")
        assert match and match.groups() == ("a.b", "c")

    def test_after_parenthesis(self):
        match = _RE_ATTRIBUTE_ACCESS.search("foo(bar.baz")
        assert match and match.groups() == ("bar", "baz")

    def test_after_operator(self):
        match = _RE_ATTRIBUTE_ACCESS.search("x + y.attr")
        assert match and match.groups() == ("y", "attr")

    def test_nested_parens_with_dot(self):
        match = _RE_ATTRIBUTE_ACCESS.search("func(a, b.c.d")
        assert match and match.groups() == ("b.c", "d")

    def test_empty_attr_prefix(self):
        match = _RE_ATTRIBUTE_ACCESS.search("obj.")
        assert match and match.groups() == ("obj", "")

    def test_no_dot(self):
        match = _RE_ATTRIBUTE_ACCESS.search("nodot")
        assert match is None


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
        ("cell_index", "expected_label"),
        [(1, "a'"), (2, "b'")],
    )
    def test_notebook_completions(self, cell_index: int, expected_label: str) -> None:
        """Test that namespace completions work in notebooks."""
        # Create server with a namespace of a few things already ran
        server = create_test_server(namespace={"x": {"a": 0}, "y": {"b": 0}})

        # Create a notebook which overwrites one of the variables
        cell_uris = create_notebook_document(server, "uri", ["y = {'a': 0}", "x['", "y['"])

        # Completions should prefer what's in the namespace
        text_document = server.workspace.get_text_document(cell_uris[cell_index])
        completions = self._completions(server, text_document)
        labels = {c.label for c in completions}
        assert labels == {expected_label}

    @pytest.mark.parametrize(
        ("source", "character", "expected_labels"),
        [
            ("x['']", 3, {"a", "b"}),
            ('x[""]', 3, {"a", "b"}),
            ("x['", None, {"a'", "b'"}),
            ('x["', None, {'a"', 'b"'}),
        ],
    )
    def test_dict_key_completion_with_closing_quote(
        self, source: str, character: Optional[int], expected_labels: set[str]
    ) -> None:
        """Test that dict key completions don't duplicate closing quote when it already exists."""
        server = create_test_server(namespace={"x": {"a": 0, "b": 1}})

        text_document = create_text_document(server, TEST_DOCUMENT_URI, source)
        completions = self._completions(server, text_document, character=character)
        labels = {c.label for c in completions}
        assert labels == expected_labels

    @pytest.mark.parametrize(
        ("source", "expected_labels"),
        [
            ("f(", ["y=", "x=", "a", "f"]),
            ("f(x", ["x=", "a", "f"]),
            ("f(y", ["y=", "a", "f"]),
            ("f(x=", ["a", "f"]),
            ("f(y=", ["a", "f"]),
            ("f(x=1,", ["y=", "a", "f"]),
            ("f(y=1,", ["x=", "a", "f"]),
        ],
    )
    def test_parameter_completions_sorting(self, source: str, expected_labels: list[str]) -> None:
        """Test that parameter completions are sorted first when appropriate."""
        server = create_test_server(namespace={"f": lambda y, x: y + x, "a": 1})
        text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

        completions = self._completions(server, text_document)
        sorted_completions = sorted(completions, key=lambda c: c.sort_text or c.label)
        labels = [c.label for c in sorted_completions]

        assert labels == expected_labels

    @pytest.mark.parametrize(
        ("source", "namespace", "character", "expected_labels"),
        [
            pytest.param(
                'x["',
                {"x": {"a": object_with_property.prop}},
                None,
                ['a"'],
                id="dict_key_to_property",
            ),
            # When completions match a variable defined in the source _and_ a variable in the user's namespace,
            # prefer the namespace variable.
            pytest.param(
                'x = {"a": 0}\nx["',
                {"x": {"b": 0}},
                None,
                ['b"'],
                id="prefer_namespace_over_source",
            ),
            pytest.param(
                'x["',
                {"x": {"a": 0}},
                None,
                ['a"'],
                id="dict_key_to_int",
            ),
            pytest.param(
                'x["',
                {"x": pd.DataFrame({"a": []})},
                None,
                ['a"'],
                id="pandas_dataframe_string_dict_key",
            ),
            pytest.param(
                'x["',
                {"x": pd.Series({"a": 0})},
                None,
                ['a"'],
                id="pandas_series_string_dict_key",
            ),
            pytest.param(
                "x[",
                {"x": pd.DataFrame({0: []})},
                None,
                ["0"],
                id="pandas_dataframe_int_dict_key",
                marks=pytest.mark.xfail(reason="Completing integer dict keys not supported"),
            ),
            pytest.param(
                'x["',
                {"x": pl.DataFrame({"a": []})},
                None,
                ['a"'],
                id="polars_dataframe_dict_key",
            ),
            pytest.param(
                "x[",
                {"x": pl.Series([0])},
                None,
                ["0"],
                id="polars_series_dict_key",
                marks=pytest.mark.xfail(reason="Completing integer dict keys not supported"),
            ),
            pytest.param(
                'os.environ["',
                {"os": os},
                None,
                [f'{TEST_ENVIRONMENT_VARIABLE}"'],
                id="os_environ",
            ),
            pytest.param(
                'import os; os.environ[""]',
                {},
                -2,
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_environ_from_source",
            ),
            pytest.param(
                'import os; os.environ["',
                {},
                None,
                [f'{TEST_ENVIRONMENT_VARIABLE}"'],
                id="os_environ_from_source_unclosed",
            ),
            pytest.param(
                'os.getenv("")',
                {"os": os},
                -2,
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_getenv",
            ),
            pytest.param(
                'import os; os.getenv("")',
                {},
                -2,
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_getenv_from_source",
            ),
            pytest.param(
                'os.getenv(key="")',
                {"os": os},
                -2,
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_getenv_keyword",
            ),
            pytest.param(
                'os.getenv(default="")',
                {"os": os},
                -2,
                [],
                id="os_getenv_keyword_default",
            ),
            pytest.param(
                'os.getenv(key="',
                {"os": os},
                None,
                [f'{TEST_ENVIRONMENT_VARIABLE}"'],
                id="os_getenv_keyword_unclosed",
            ),
            pytest.param(
                'os.getenv(default="',
                {"os": os},
                None,
                [],
                id="os_getenv_keyword_default_unclosed",
            ),
            pytest.param(
                'os.getenv("", "")',
                {"os": os},
                len('os.getenv("'),
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_getenv_with_default",
            ),
            pytest.param(
                'os.getenv("", default="")',
                {"os": os},
                len('os.getenv("'),
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_getenv_with_keyword_default",
            ),
            pytest.param(
                'os.getenv("',
                {"os": os},
                None,
                [f'{TEST_ENVIRONMENT_VARIABLE}"'],
                id="os_getenv_unclosed",
            ),
            pytest.param(
                'os.getenv("", "")',
                {"os": os},
                -2,
                [],
                id="os_getenv_wrong_arg",
            ),
            pytest.param(
                'os.getenv("", "',
                {"os": os},
                None,
                [],
                id="os_getenv_wrong_arg_unclosed",
            ),
            # Static analysis tests with aliases
            pytest.param(
                'import os as system; system.environ[""]',
                {},
                -2,
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_environ_from_source_with_alias",
            ),
            pytest.param(
                'import os as system; system.environ["',
                {},
                None,
                [f'{TEST_ENVIRONMENT_VARIABLE}"'],
                id="os_environ_from_source_with_alias_unclosed",
            ),
            pytest.param(
                'import os as o; o.getenv("")',
                {},
                -2,
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_getenv_from_source_with_alias",
            ),
            pytest.param(
                'import os as o; o.getenv("',
                {},
                None,
                [f'{TEST_ENVIRONMENT_VARIABLE}"'],
                id="os_getenv_from_source_with_alias_unclosed",
            ),
            # Multiline import tests
            pytest.param(
                'import sys, os\nos.environ[""]',
                {},
                -2,
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_environ_multiline_import",
            ),
            pytest.param(
                'import os\n\n\nos.getenv("")',
                {},
                -2,
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_getenv_multiline_import",
            ),
            # Tests with os already in namespace (namespace should take priority)
            pytest.param(
                'import os as alias; os.environ[""]',
                {"os": os},
                -2,
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_environ_namespace_priority_over_alias",
            ),
            pytest.param(
                'import os as alias; os.getenv("")',
                {"os": os},
                -2,
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_getenv_namespace_priority_over_alias",
            ),
            pytest.param(
                'import os as alias; alias.environ[""]',
                {"os": os},
                -2,
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_environ_alias_with_os_in_namespace",
            ),
            pytest.param(
                'import os as alias; alias.getenv("")',
                {"os": os},
                -2,
                [TEST_ENVIRONMENT_VARIABLE],
                id="os_getenv_alias_with_os_in_namespace",
            ),
        ],
    )
    def test_completions(
        self,
        source: str,
        namespace: Dict[str, Any],
        character: Optional[int],
        expected_labels: List[str],
        monkeypatch,
        tmp_path,
    ) -> None:
        # Set the root path to an empty temporary directory so there are no file completions.
        server = create_test_server(namespace, root_path=tmp_path)
        text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

        # Patch os.environ so that only the test environment variable's completion is ever present.
        with patch.dict(os.environ, clear=True):
            monkeypatch.setenv(TEST_ENVIRONMENT_VARIABLE, "")
            completions = self._completions(server, text_document, character)

        labels = [c.label for c in completions]

        for expected in expected_labels:
            assert expected in labels, f"Expected '{expected}' in {labels}"

    @pytest.mark.parametrize(
        ("source", "namespace", "expected_label"),
        [
            # Pandas dataframe - attribute access
            pytest.param(
                "x.a",
                {"x": pd.DataFrame({"a": []})},
                "a",
                id="pandas_dataframe_attribute",
            ),
            # Polars does not support this
        ],
    )
    def test_completion_contains(
        self,
        source: str,
        namespace: Dict[str, Any],
        expected_label: str,
    ) -> None:
        """Test that specific completions are present in the results."""
        server = create_test_server(namespace)
        text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

        completions = self._completions(server, text_document)
        labels = [c.label for c in completions]

        assert expected_label in labels

    def _assert_has_path_completion(
        self,
        source: str,
        expected_completion: str,
        chars_from_end: int = 1,
        root_path: Optional[Path] = None,
        working_directory: Optional[str] = None,
    ):
        server = create_test_server(root_path=root_path, working_directory=working_directory)
        text_document = create_text_document(server, TEST_DOCUMENT_URI, source)
        character = len(source) - chars_from_end
        completions = self._completions(server, text_document, character)

        assert len(completions) == 1

        expected_position = Position(0, character)
        expected_range = Range(expected_position, expected_position)
        assert completions[0].text_edit == InsertReplaceEdit(
            new_text=expected_completion,
            insert=expected_range,
            replace=expected_range,
        )

    @pytest.mark.parametrize(
        ("source", "expected_completion", "chars_from_end"),
        [
            ('""', "my-notebooks.new/", 1),
            # Quotes aren't automatically closed for directories, since the user may want a file.
            ('"', "my-notebooks.new/", 0),
            ('"my"', "-notebooks.new/", 1),
            ('"my-notebooks"', ".new/", 1),
            ('"my-notebooks."', "new/", 1),
            ('"my-notebooks.new"', "/", 1),
            # Check file completions at various points around symbols.
            ('"my-notebooks.new/"', "weather-report.ipynb", 1),
            # Quotes are automatically closed for files, since they end the completion.
            ('"my-notebooks.new/', 'weather-report.ipynb"', 0),
            ('"my-notebooks.new/weather"', "-report.ipynb", 1),
            ('"my-notebooks.new/weather-report"', ".ipynb", 1),
            ('"my-notebooks.new/weather-report."', "ipynb", 1),
            ('"my-notebooks.new/weather-report.ipynb"', "", 1),
        ],
    )
    def test_path_completion(
        self, tmp_path: Path, source: str, expected_completion: str, chars_from_end: int
    ) -> None:
        """Test path completions for files and directories."""
        # See https://github.com/posit-dev/positron/issues/5193.

        dir_ = tmp_path / "my-notebooks.new"
        dir_.mkdir()

        file = dir_ / "weather-report.ipynb"
        file.write_text("")

        self._assert_has_path_completion(
            source,
            expected_completion,
            chars_from_end,
            root_path=tmp_path,
        )

    def test_notebook_path_completions(self, tmp_path: Path) -> None:
        """Test that notebook path completions use the notebook's parent directory."""
        # Notebook path completions should be in the notebook's parent, not root path.
        # See: https://github.com/posit-dev/positron/issues/5948
        notebook_parent = tmp_path / "notebooks"
        notebook_parent.mkdir()

        # Create a file in the notebook's parent.
        file_to_complete = notebook_parent / "data.csv"
        file_to_complete.write_text("")

        self._assert_has_path_completion(
            source='""',
            expected_completion=file_to_complete.name,
            root_path=tmp_path,
            working_directory=str(notebook_parent),
        )

    def test_notebook_path_completions_different_wd(self, tmp_path: Path) -> None:
        """Test that notebook path completions respect custom working directory."""
        notebook_parent = tmp_path / "notebooks"
        notebook_parent.mkdir()

        # Make a different working directory.
        working_directory = tmp_path / "different-working-directory"
        working_directory.mkdir()

        # Create files in the notebook's parent and the working directory.
        bad_file = notebook_parent / "bad-data.csv"
        bad_file.write_text("")
        good_file = working_directory / "good-data.csv"
        good_file.write_text("")

        self._assert_has_path_completion(
            source='""',
            expected_completion=good_file.name,
            root_path=tmp_path,
            working_directory=str(working_directory),
        )

    def test_path_completion_single_quotes(self, tmp_path: Path) -> None:
        """Test path completions with single quotes."""
        file = tmp_path / "data.csv"
        file.write_text("")

        self._assert_has_path_completion(
            source="''",
            expected_completion="data.csv",
            root_path=tmp_path,
        )

    def test_path_completion_hidden_files(self, tmp_path: Path) -> None:
        """Test that hidden files are only shown when prefix starts with '.'."""
        # Create both hidden and visible files
        hidden_file = tmp_path / ".gitignore"
        hidden_file.write_text("")
        visible_file = tmp_path / "readme.md"
        visible_file.write_text("")

        # Without dot prefix, should complete to visible file
        self._assert_has_path_completion(
            source='"r"',
            expected_completion="eadme.md",
            root_path=tmp_path,
        )

    def test_path_completion_hidden_files_with_dot(self, tmp_path: Path) -> None:
        """Test that hidden files are shown when prefix starts with '.'."""
        hidden_file = tmp_path / ".gitignore"
        hidden_file.write_text("")

        self._assert_has_path_completion(
            source='"."',
            expected_completion="gitignore",
            root_path=tmp_path,
        )

    def test_path_completion_empty_directory(self, tmp_path: Path) -> None:
        """Test path completion in empty directory returns no completions."""
        server = create_test_server(root_path=tmp_path)
        text_document = create_text_document(server, TEST_DOCUMENT_URI, '""')
        completions = self._completions(server, text_document, character=1)

        assert len(completions) == 0

    def test_path_completion_nonexistent_path(self, tmp_path: Path) -> None:
        """Test path completion with non-existent directory returns no completions."""
        server = create_test_server(root_path=tmp_path)
        text_document = create_text_document(server, TEST_DOCUMENT_URI, '"nonexistent/"')
        completions = self._completions(server, text_document, character=13)

        assert len(completions) == 0

    def test_path_completion_multiple_files(self, tmp_path: Path) -> None:
        """Test path completion returns multiple matching files."""
        # Create multiple files
        (tmp_path / "data1.csv").write_text("")
        (tmp_path / "data2.csv").write_text("")
        (tmp_path / "other.txt").write_text("")

        server = create_test_server(root_path=tmp_path)
        text_document = create_text_document(server, TEST_DOCUMENT_URI, '"data"')
        completions = self._completions(server, text_document, character=5)

        # Should return 2 completions for files starting with "data"
        assert len(completions) == 2
        labels = {c.label for c in completions}
        assert labels == {"data1.csv", "data2.csv"}

    def test_path_completion_directories_first(self, tmp_path: Path) -> None:
        """Test that directories are listed before files."""
        # Create a directory and a file with same prefix
        (tmp_path / "assets").mkdir()
        (tmp_path / "assets.txt").write_text("")

        server = create_test_server(root_path=tmp_path)
        text_document = create_text_document(server, TEST_DOCUMENT_URI, '"a"')
        completions = self._completions(server, text_document, character=2)

        # Should have 2 completions, with directory first
        assert len(completions) == 2
        assert completions[0].label == "assets"  # Directory first
        assert completions[1].label == "assets.txt"  # File second

    def test_path_completion_falls_back_to_home(self, tmp_path: Path, monkeypatch) -> None:
        """Test that path completions fall back to home directory when no root_path or working_directory."""
        # Create a file in the "fake" home directory
        home_file = tmp_path / "home-file.txt"
        home_file.write_text("")

        # Mock Path.home() to return our temp directory
        monkeypatch.setattr(Path, "home", lambda: tmp_path)

        # Create server with NO root_path and NO working_directory
        server = create_test_server(root_path=None, working_directory=None)
        text_document = create_text_document(server, TEST_DOCUMENT_URI, '"home"')
        completions = self._completions(server, text_document, character=5)

        # Should find the file in the mocked home directory
        assert len(completions) == 1
        assert completions[0].label == "home-file.txt"

    def test_path_completion_without_shell(self, tmp_path: Path) -> None:
        """Test that path completions work even when server.shell is None."""
        file = tmp_path / "readme.txt"
        file.write_text("")

        server = create_test_server(root_path=tmp_path)
        server.shell = None

        text_document = create_text_document(server, TEST_DOCUMENT_URI, '"read"')
        completions = self._completions(server, text_document, character=5)

        assert len(completions) == 1
        assert completions[0].label == "readme.txt"

    def test_no_non_path_completions_without_shell(self) -> None:
        """Test that non-path completions return nothing when server.shell is None."""
        server = create_test_server(namespace={"foo": 1})
        server.shell = None

        text_document = create_text_document(server, TEST_DOCUMENT_URI, "fo")
        completions = self._completions(server, text_document)

        assert completions == []

    def test_line_magic_completions(self) -> None:
        """Test completions for line magics."""
        server = create_test_server()
        assert server.shell is not None
        server.shell.magics_manager.lsmagic.return_value = {
            "line": {"timeit": None, "time": None},
            "cell": {},
        }
        text_document = create_text_document(server, TEST_DOCUMENT_URI, "%ti")

        completions = self._completions(server, text_document)
        labels = [c.label for c in completions]

        assert set(labels) == {"%timeit", "%time"}

    def test_cell_magic_completions(self) -> None:
        """Test completions for cell magics."""
        server = create_test_server()
        assert server.shell is not None
        server.shell.magics_manager.lsmagic.return_value = {
            "line": {},
            "cell": {"timeit": None, "time": None},
        }
        text_document = create_text_document(server, TEST_DOCUMENT_URI, "%%ti")

        completions = self._completions(server, text_document)
        labels = [c.label for c in completions]

        assert set(labels) == {"%%timeit", "%%time"}


class TestCompletionItemResolve:
    """Tests for completion item resolve functionality."""

    @pytest.mark.parametrize(
        ("source", "namespace", "expected_detail_contains", "expected_doc_contains"),
        [
            pytest.param(
                'x["',
                {"x": {"a": object_with_property.prop}},
                "str",
                None,
                id="dict_key_to_property",
            ),
            pytest.param(
                'x["',
                {"x": {"a": 0}},
                "int",
                None,
                id="dict_key_to_int",
            ),
            pytest.param(
                "x",
                {"x": 0},
                "int",
                None,
                id="int",
            ),
            pytest.param(
                "x",
                {"x": pd.DataFrame({"col1": [1, 2, 3]})},
                "DataFrame (3 x 1)",
                "col1",
                id="pandas_dataframe",
            ),
            pytest.param(
                'x["',
                {"x": pd.DataFrame({"a": [1, 2, 3]})},
                "int64 (3)",
                "dtype: int64",
                id="pandas_dataframe_dict_key",
            ),
            pytest.param(
                "x",
                {"x": pd.Series([1, 2, 3])},
                "int64 (3)",
                "dtype: int64",
                id="pandas_series",
            ),
            pytest.param(
                "x",
                {"x": pl.DataFrame({"col1": [1, 2, 3]})},
                "DataFrame (3 x 1)",
                "col1",
                id="polars_dataframe",
            ),
            pytest.param(
                'x["',
                {"x": pl.DataFrame({"a": [1, 2, 3]})},
                "Int64 (3)",
                "1",
                id="polars_dataframe_dict_key",
            ),
            pytest.param(
                "x",
                {"x": pl.Series([1, 2, 3])},
                "Int64 (3)",
                "1",
                id="polars_series",
            ),
        ],
    )
    def test_completion_item_resolve(
        self,
        source: str,
        namespace: Dict[str, Any],
        expected_detail_contains: str,
        expected_doc_contains: Optional[str],
    ) -> None:
        """Test that completion items can be resolved with additional details."""
        from positron.positron_lsp import _handle_completion, _handle_completion_resolve

        server = create_test_server(namespace)
        text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

        line = len(text_document.lines) - 1
        character = len(text_document.lines[line])
        params = CompletionParams(
            TextDocumentIdentifier(text_document.uri),
            Position(line, character),
        )
        completion_list = _handle_completion(server, params)

        assert completion_list is not None
        assert len(completion_list.items) > 0

        item = completion_list.items[0]

        # Dict key completions defer detail to resolve for performance
        is_dict_key_completion = '["' in source or "['" in source
        if is_dict_key_completion:
            # Verify detail is not set initially and data has expected structure
            assert item.detail is None
            assert item.data is not None
            assert item.data.get("type") == "dict_key"
            assert "expr" in item.data
            assert "key" in item.data

        resolved_item = _handle_completion_resolve(server, item)
        assert resolved_item.detail is not None
        assert expected_detail_contains in resolved_item.detail

        # Check documentation preview for DataFrame/Series
        if expected_doc_contains is not None:
            assert resolved_item.documentation is not None
            doc_value = (
                resolved_item.documentation.value
                if isinstance(resolved_item.documentation, MarkupContent)
                else resolved_item.documentation
            )
            assert expected_doc_contains in doc_value


class TestSignatureHelp:
    """Tests for signature help functionality."""

    def _signature_help(
        self,
        server: PositronLanguageServer,
        text_document: TextDocument,
        position: Position,
    ) -> Optional[SignatureHelp]:
        from positron.positron_lsp import _handle_signature_help

        params = TextDocumentPositionParams(TextDocumentIdentifier(text_document.uri), position)
        return _handle_signature_help(server, params)

    @pytest.mark.parametrize(
        ("source", "namespace"),
        [
            pytest.param(
                "func(",
                {"func": func},
                id="from_namespace",
            ),
        ],
    )
    def test_positron_signature_help(self, source: str, namespace: Dict[str, Any]) -> None:
        """Test signature help on functions."""
        server = create_test_server(namespace)
        text_document = create_text_document(server, TEST_DOCUMENT_URI, source)

        # Position at end of document
        line = len(text_document.lines) - 1
        character = len(text_document.lines[line])
        position = Position(line, character)

        sig_help = self._signature_help(server, text_document, position)

        assert sig_help is not None
        assert len(sig_help.signatures) == 1
        assert sig_help.signatures[0].label == _func_label[len("def ") :]

    def test_signature_help_on_function(self) -> None:
        """Signature help should work on functions."""
        server = create_test_server({"print": print})
        text_document = create_text_document(server, TEST_DOCUMENT_URI, "print(")

        sig_help = self._signature_help(server, text_document, Position(0, 6))

        assert sig_help is not None
        assert len(sig_help.signatures) == 1
        assert sig_help.signatures[0].label.startswith("print(")

    def test_signature_help_on_custom_function(self) -> None:
        """Signature help should work on user-defined functions."""

        def custom_func(a: int, b: str) -> None:
            pass

        server = create_test_server({"custom_func": custom_func})
        text_document = create_text_document(server, TEST_DOCUMENT_URI, "custom_func(")

        sig_help = self._signature_help(server, text_document, Position(0, 12))

        assert sig_help is not None
        assert len(sig_help.signatures) == 1
        assert sig_help.signatures[0].label.startswith("custom_func(")

    def test_notebook_signature_help(self) -> None:
        """Test that signature help works across notebook cells."""
        server = create_test_server({"func": func})

        # Create a notebook which defines a function in one cell and uses it in another
        func_def = "def func(x, y):\n    pass"
        cell_uris = create_notebook_document(server, "uri", [func_def, "func("])
        text_document = server.workspace.get_text_document(cell_uris[1])

        sig_help = self._signature_help(server, text_document, Position(0, 12))

        assert sig_help is not None
        assert len(sig_help.signatures) == 1
        assert sig_help.signatures[0].label == _func_label[len("def ") :]


class TestHover:
    """Tests for hover functionality."""

    def _hover(
        self,
        server: PositronLanguageServer,
        text_document: TextDocument,
        position: Position,
    ) -> Optional[Hover]:
        from positron.positron_lsp import _handle_hover

        params = HoverParams(TextDocumentIdentifier(text_document.uri), position)
        return _handle_hover(server, params)  # type: ignore[arg-type]

    def test_hover_on_variable(self) -> None:
        """Hover should work on variables."""
        server = create_test_server({"x": 42})
        text_document = create_text_document(server, TEST_DOCUMENT_URI, "x")

        hover = self._hover(server, text_document, Position(0, 0))

        assert hover is not None
        assert getattr(hover.contents, "value", "").startswith("""**x**: `int`

---
int([x]) -> integer""")

    def test_hover_on_dataframe(self) -> None:
        """Hover should work on DataFrames."""
        df = pd.DataFrame({"col1": [1, 2, 3]})
        server = create_test_server({"df": df})
        text_document = create_text_document(server, TEST_DOCUMENT_URI, "df")

        hover = self._hover(server, text_document, Position(0, 0))

        assert hover is not None
        assert getattr(hover.contents, "value", "").startswith("""**df**: `DataFrame`

```
   col1
0     1
1     2
2     3
```

---
Two-dimensional,""")


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
