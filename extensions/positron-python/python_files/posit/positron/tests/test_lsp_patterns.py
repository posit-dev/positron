#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""Tests for pre-compiled regex patterns in _Patterns."""

import pytest

from positron.positron_lsp import _Patterns


class TestStatementSplit:
    """Split source code by semicolons or newlines."""

    @pytest.mark.parametrize(
        ("source", "expected"),
        [
            ("a;b", ["a", "b"]),
            ("a\nb", ["a", "b"]),
            ("a;b\nc", ["a", "b", "c"]),
            ("import os; x = 1", ["import os", " x = 1"]),
            ("no_separator", ["no_separator"]),
            ("", [""]),
            (";\n;", ["", "", "", ""]),
        ],
    )
    def test_split(self, source: str, expected: list[str]) -> None:
        assert _Patterns.STATEMENT_SPLIT.split(source) == expected


class TestDictKeyAccess:
    """Match dict/DataFrame subscript access like obj["key."""

    @pytest.mark.parametrize(
        ("text", "expr", "quote", "prefix"),
        [
            ('x["', "x", '"', ""),
            ("x['", "x", "'", ""),
            ('x["abc', "x", '"', "abc"),
            ("df['col", "df", "'", "col"),
            ('obj.attr["key', "obj.attr", '"', "key"),
            ('x  ["', "x", '"', ""),
            ('x["key_name', "x", '"', "key_name"),
        ],
    )
    def test_match(self, text: str, expr: str, quote: str, prefix: str) -> None:
        m = _Patterns.DICT_KEY_ACCESS.search(text)
        assert m is not None
        assert m.group(1) == expr
        assert m.group(2) == quote
        assert m.group(3) == prefix

    @pytest.mark.parametrize(
        "text",
        [
            "x[",
            "x[1",
            "x",
            "",
            "['",
            '["',
        ],
    )
    def test_no_match(self, text: str) -> None:
        assert _Patterns.DICT_KEY_ACCESS.search(text) is None


class TestDottedIdentifier:
    """Match trailing dotted identifier like os.path.join."""

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("os.path.join", "os.path.join"),
            ("func", "func"),
            ("  os.getenv", "os.getenv"),
            ("x = os.path", "os.path"),
            ("a", "a"),
        ],
    )
    def test_match(self, text: str, expected: str) -> None:
        m = _Patterns.DOTTED_IDENTIFIER.search(text)
        assert m is not None
        assert m.group(1) == expected

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "   ",
            "=",
            "(",
        ],
    )
    def test_no_match(self, text: str) -> None:
        assert _Patterns.DOTTED_IDENTIFIER.search(text) is None


class TestKwargValue:
    """Match keyword argument with value started, like x=1 at end."""

    @pytest.mark.parametrize(
        "text",
        [
            "x=1",
            "x=val",
            "x =val",
            "x= val",
            "key=",
            "key = ",
        ],
    )
    def test_match(self, text: str) -> None:
        assert _Patterns.KWARG_VALUE.search(text) is not None

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "x",
            "x=1,",
            "x=1, ",
            "=val",
        ],
    )
    def test_no_match(self, text: str) -> None:
        assert _Patterns.KWARG_VALUE.search(text) is None


class TestKwargName:
    """Match keyword argument names before =."""

    @pytest.mark.parametrize(
        ("text", "names"),
        [
            ("key=", ["key"]),
            ("x=1, y=2", ["x", "y"]),
            ("a=", ["a"]),
            ("abc =", ["abc"]),
        ],
    )
    def test_finditer(self, text: str, names: list[str]) -> None:
        matches = list(_Patterns.KWARG_NAME.finditer(text))
        assert [m.group(1) for m in matches] == names

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "hello",
            "==",
        ],
    )
    def test_no_match(self, text: str) -> None:
        assert list(_Patterns.KWARG_NAME.finditer(text)) == []


class TestPartialParam:
    """Match partial parameter name at start or after comma."""

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("par", "par"),
            (", par", "par"),
            (",  par", "par"),
            ("x=1, y", "y"),
            ("abc", "abc"),
        ],
    )
    def test_match(self, text: str, expected: str) -> None:
        m = _Patterns.PARTIAL_PARAM.search(text)
        assert m is not None
        assert m.group(1) == expected

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "x=",
            "x=1,",
            ", ",
            ",",
        ],
    )
    def test_no_match(self, text: str) -> None:
        assert _Patterns.PARTIAL_PARAM.search(text) is None


class TestTrailingWord:
    """Match trailing word characters (partial identifier)."""

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("foo", "foo"),
            ("x = bar", "bar"),
            ("f(abc", "abc"),
            ("", ""),
            ("  ", ""),
            ("x=", ""),
        ],
    )
    def test_match(self, text: str, expected: str) -> None:
        m = _Patterns.TRAILING_WORD.search(text)
        assert m is not None
        assert m.group(1) == expected


class TestAliasEnviron:
    """Match <alias>.environ for static os.environ detection."""

    @pytest.mark.parametrize(
        ("text", "alias"),
        [
            ("os.environ", "os"),
            ("system.environ", "system"),
            ("o.environ", "o"),
        ],
    )
    def test_match(self, text: str, alias: str) -> None:
        m = _Patterns.ALIAS_ENVIRON.match(text)
        assert m is not None
        assert m.group(1) == alias

    @pytest.mark.parametrize(
        "text",
        [
            "environ",
            ".environ",
            "os.path.environ",
            "os.getenv",
            "",
            "os.environ.keys",
        ],
    )
    def test_no_match(self, text: str) -> None:
        assert _Patterns.ALIAS_ENVIRON.match(text) is None


class TestStringLiteral:
    """Match cursor inside a string literal."""

    @pytest.mark.parametrize(
        ("text", "quote", "content"),
        [
            ('"', '"', ""),
            ("'", "'", ""),
            ('"abc', '"', "abc"),
            ("'abc", "'", "abc"),
            ('x = "hello', '"', "hello"),
            ("f('", "'", ""),
            ('f("path/to/file', '"', "path/to/file"),
        ],
    )
    def test_match(self, text: str, quote: str, content: str) -> None:
        m = _Patterns.STRING_LITERAL.search(text)
        assert m is not None
        assert m.group(1) == quote
        assert m.group(2) == content

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "abc",
            "123",
        ],
    )
    def test_no_match(self, text: str) -> None:
        assert _Patterns.STRING_LITERAL.search(text) is None

    @pytest.mark.parametrize(
        "text",
        [
            '""',
            "''",
            '"abc"',
            "'abc'",
        ],
    )
    def test_closed_string_still_matches_closing_quote(self, text: str) -> None:
        """The pattern matches the last quote char, even in closed strings.

        This is expected — callers use additional context (text_after_cursor)
        to determine whether the string is already closed.
        """
        assert _Patterns.STRING_LITERAL.search(text) is not None


class TestKwargTrailing:
    """Match keyword name= at end with no value started."""

    @pytest.mark.parametrize(
        ("text", "name"),
        [
            ("key=", "key"),
            ("key =", "key"),
            ("key = ", "key"),
            ("f(key=", "key"),
            ("default=", "default"),
        ],
    )
    def test_match(self, text: str, name: str) -> None:
        m = _Patterns.KWARG_TRAILING.search(text)
        assert m is not None
        assert m.group(1) == name

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "key",
            "key=1",
            "=",
            "= ",
        ],
    )
    def test_no_match(self, text: str) -> None:
        assert _Patterns.KWARG_TRAILING.search(text) is None


class TestDottedIdentifierWs:
    """Match trailing dotted identifier with optional trailing whitespace."""

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("os.getenv", "os.getenv"),
            ("os.getenv ", "os.getenv"),
            ("os.getenv  ", "os.getenv"),
            ("x = os.path", "os.path"),
            ("func", "func"),
        ],
    )
    def test_match(self, text: str, expected: str) -> None:
        m = _Patterns.DOTTED_IDENTIFIER_WS.search(text)
        assert m is not None
        assert m.group(1) == expected

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "   ",
        ],
    )
    def test_no_match(self, text: str) -> None:
        assert _Patterns.DOTTED_IDENTIFIER_WS.search(text) is None


class TestAliasGetenv:
    """Match <alias>.getenv for static os.getenv detection."""

    @pytest.mark.parametrize(
        ("text", "alias"),
        [
            ("os.getenv", "os"),
            ("system.getenv", "system"),
            ("o.getenv", "o"),
        ],
    )
    def test_match(self, text: str, alias: str) -> None:
        m = _Patterns.ALIAS_GETENV.match(text)
        assert m is not None
        assert m.group(1) == alias

    @pytest.mark.parametrize(
        "text",
        [
            "getenv",
            ".getenv",
            "os.path.getenv",
            "os.environ",
            "",
            "os.getenv.call",
        ],
    )
    def test_no_match(self, text: str) -> None:
        assert _Patterns.ALIAS_GETENV.match(text) is None


class TestAttributeAccess:
    """Match attribute access like expr.attr_prefix at end of line."""

    @pytest.mark.parametrize(
        ("text", "base", "attr"),
        [
            ("df.col", "df", "col"),
            ("df.", "df", ""),
            ("os.path.join", "os.path", "join"),
            ("x = obj.method", "obj", "method"),
            ("  obj.attr", "obj", "attr"),
        ],
    )
    def test_match(self, text: str, base: str, attr: str) -> None:
        m = _Patterns.ATTRIBUTE_ACCESS.match(text)
        assert m is not None
        assert m.group(1) == base
        assert m.group(2) == attr

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "abc",
            ".attr",
        ],
    )
    def test_no_match(self, text: str) -> None:
        assert _Patterns.ATTRIBUTE_ACCESS.match(text) is None


class TestTrailingToken:
    """Match trailing non-whitespace token."""

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("%timeit", "%timeit"),
            ("  %%cell", "%%cell"),
            ("", ""),
            ("  ", ""),
            ("hello world", "world"),
        ],
    )
    def test_match(self, text: str, expected: str) -> None:
        m = _Patterns.TRAILING_TOKEN.search(text)
        assert m is not None
        assert m.group(1) == expected


class TestLeadingPercent:
    """Match leading percent signs for magic commands."""

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("%timeit", "%"),
            ("%%timeit", "%%"),
            ("%%%", "%%%"),
            ("timeit", ""),
            ("", ""),
        ],
    )
    def test_match(self, text: str, expected: str) -> None:
        m = _Patterns.LEADING_PERCENT.match(text)
        assert m is not None
        assert m.group(1) == expected
