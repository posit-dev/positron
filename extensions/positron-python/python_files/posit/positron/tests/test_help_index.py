#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import os
import pkgutil
import sys
import time
from pathlib import Path
from types import ModuleType

import pytest

from positron.help_index import _source_summary, find_modules, search, suggest


@pytest.fixture
def library(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Make a temporary directory the only `sys.path` entry, and return a writer for it."""
    monkeypatch.setattr(sys, "path", [str(tmp_path)])
    monkeypatch.setattr(sys, "builtin_module_names", ("builtin_fixture",))

    def write(name: str, text: str = '"""Fixture summary."""\n') -> Path:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    return write


def fixture_names(names) -> list[str]:
    return sorted(name for name in names if name.split(".")[0].startswith("fx"))


def fixture_results(results) -> list[tuple[str, str | None]]:
    return [result for result in results if result[0].startswith("fx")]


def test_lists_modules_packages_and_one_level_of_submodules(library):
    for name in [
        "fxmod.py",
        "fxpkg/__init__.py",
        "fxpkg/sub.py",
        "fxpkg/__main__.py",
        "fxpkg/inner/__init__.py",
        "fxpkg/inner/deep.py",
        "fxdata/notes.txt",
        "fxspace/mod.py",
    ]:
        library(name)
    modules = find_modules()
    # Directories without `__init__.py` are not listed, as in pkgutil. `__main__`
    # modules are not listed, because importing one runs a package's command line.
    assert fixture_names(modules) == ["fxmod", "fxpkg", "fxpkg.inner", "fxpkg.sub"]
    assert "builtin_fixture" in modules
    assert "__main__" not in modules


class FakeModule:
    """Reports ModuleType as its class without being a module, like cffi's `Lib`."""

    @property
    def __class__(self):  # type: ignore[override]
        return ModuleType


def test_does_not_list_the_home_directory(library, tmp_path, monkeypatch):
    # Listing the home directory would open folders such as Documents.
    library("fxmod.py")
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    assert fixture_names(find_modules()) == []


def test_reuses_the_listing_until_a_search_path_entry_changes(library, tmp_path, monkeypatch):
    library("fxmod.py")
    assert fixture_names(find_modules()) == ["fxmod"]

    listings = []
    iter_modules = pkgutil.iter_modules
    monkeypatch.setattr(
        pkgutil, "iter_modules", lambda path=None: listings.append(path) or iter_modules(path)
    )
    assert fixture_names(find_modules()) == ["fxmod"]
    assert listings == []

    library("fxnew.py")
    # Some filesystems record modification times only to the second.
    os.utime(tmp_path, ns=(time.time_ns(), time.time_ns() + 2_000_000_000))
    assert fixture_names(find_modules()) == ["fxmod", "fxnew"]
    assert listings


def test_lists_imported_modules(library, monkeypatch):
    library("fxpkg/__init__.py")
    monkeypatch.setitem(sys.modules, "fxpkg.inner.deep", ModuleType("fxpkg.inner.deep"))
    monkeypatch.setitem(sys.modules, "fx_not_a_module", object())
    monkeypatch.setitem(sys.modules, "fx_fake_module", FakeModule())
    monkeypatch.setitem(sys.modules, "fx-not-a-name", ModuleType("fx-not-a-name"))
    assert fixture_names(find_modules()) == ["fxpkg", "fxpkg.inner.deep"]


def test_finding_and_searching_import_nothing(library, monkeypatch):
    library("fxpkg/__init__.py", '"""Fixture summary."""\nraise RuntimeError("imported")\n')
    library("fxpkg/sub.py", 'raise RuntimeError("imported")\n')

    class ImportTrap:
        def find_spec(self, *_args, **_kwargs):
            raise AssertionError("A module was imported")

    monkeypatch.setattr(sys, "meta_path", [ImportTrap(), *sys.meta_path])
    before = set(sys.modules)
    assert fixture_names(find_modules()) == ["fxpkg", "fxpkg.sub"]
    assert ("fxpkg", "Fixture summary.") in search("fixture")
    assert set(sys.modules) == before


def test_suggestions_rank_public_and_shallow_modules_first(library):
    for name in [
        "fxpkg/__init__.py",
        "fxpkg/_core/__init__.py",
        "fxpkg/linalg/__init__.py",
        "fxpkg/random.py",
        "_fxpkg_private.py",
        "fxother_fxpkg.py",
    ]:
        library(name)
    assert suggest("fxpkg", 50) == [
        "fxpkg",
        "fxpkg.linalg",
        "fxpkg.random",
        "fxpkg._core",
        "fxother_fxpkg",
        "_fxpkg_private",
    ]
    assert suggest("FXPKG", 2) == ["fxpkg", "fxpkg.linalg"]
    assert suggest("  ", 50) == []


def test_search_matches_names_and_summaries_ignoring_case(library):
    library("fxalpha.py", '"""Linear Algebra tools."""\n')
    library("fxbeta.py", '"""Something else."""\n')
    library("fxgamma.py", "x = 1\n")
    assert fixture_results(search("linear algebra")) == [("fxalpha", "Linear Algebra tools.")]
    assert fixture_results(search("FXBETA")) == [("fxbeta", "Something else.")]
    assert fixture_results(search("fxgamma")) == [("fxgamma", None)]


def test_search_uses_the_docstring_of_an_imported_module(library, monkeypatch):
    library("fxmod.py", '"""Summary on disk."""\n')
    monkeypatch.setitem(sys.modules, "fxmod", ModuleType("fxmod", "Summary at runtime."))
    monkeypatch.setitem(sys.modules, "fxruntime", ModuleType("fxruntime", "Only at runtime."))
    monkeypatch.setitem(sys.modules, "fx_fake_runtime", FakeModule())
    assert fixture_results(search("runtime")) == [
        ("fxmod", "Summary at runtime."),
        ("fxruntime", "Only at runtime."),
    ]


@pytest.mark.parametrize(
    ("source", "summary"),
    [
        (b'"""Plain summary.\n\nMore text."""\n', "Plain summary."),
        (b"'Single quotes.'\n", "Single quotes."),
        (b'r"""Raw \\d summary."""\n', "Raw \\d summary."),
        (b'#!/usr/bin/env python\n# A comment.\n\n"""After comments."""\n', "After comments."),
        (b'"""\n    Summary on the second line.\n"""\n', "Summary on the second line."),
        ('# coding: latin-1\n"""Caf\xe9."""\n'.encode("latin-1"), "Caf\xe9."),
        (b'\xef\xbb\xbf"""With a BOM."""\n', "With a BOM."),
        (b'"""No trailing newline."""', "No trailing newline."),
        (b'import os\n"""Not a docstring."""\n', None),
        (b'""""""\n', None),
        (b"", None),
        (b'"""\xff"""\n', None),
        (b'"""Never closed.\n', None),
    ],
)
def test_source_summary(tmp_path: Path, source: bytes, summary: str | None):
    path = tmp_path / "module.py"
    path.write_bytes(source)
    assert _source_summary(path) == summary
