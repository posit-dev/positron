#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import contextlib
import importlib.abc
import io
import py_compile
import pydoc
import sys
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

from positron.help_index import Discovery, HelpIndex, snapshot_loaded_modules


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="help-discovery-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write(self, name, text='"""Quasar summary."""\n'):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def scan(self, roots=None):
        return Discovery().build(roots or [self.root], builtins=())

    def names(self, index):
        return [t.name for t in index.topics]

    def legacy(self, key=""):
        found = []
        with patch.object(sys, "path", [str(self.root)]), patch.object(
            sys, "builtin_module_names", ()
        ):
            pydoc.ModuleScanner().run(
                lambda _p, n, d: found.append((n.removesuffix(".__init__"), d)),
                key,
                onerror=lambda _n: None,
            )
        return sorted(found)

    def test_regular_names_and_source_search_match_legacy(self):
        self.write("stage2_example/__init__.py", '"""Example package."""\n')
        self.write(
            "stage2_example/tools.py", '"""Quasar regression utilities."""\ndef run(): pass\n'
        )
        self.write("stage2_example/sub/__init__.py")
        index = self.scan()
        assert [(t.name, t.summary or "") for t in index.topics] == self.legacy()
        assert [(t.name, t.summary) for t in index.search("QUASAR")] == self.legacy("QUASAR")
        assert self.names(index) == ["stage2_example", "stage2_example.sub", "stage2_example.tools"]
        assert index.suggest("run") == ()
        assert index.search("nonexistent_unique_query") == ()

    def test_no_import_hooks_execution_stdout_or_sysmodules_changes(self):
        self.write(
            "stage2_danger/__init__.py",
            '"""Safe to read."""\nprint("EXECUTED")\nraise RuntimeError("must not execute")\n',
        )
        self.write("stage2_danger/sub.py")

        class Trap(importlib.abc.MetaPathFinder):
            def find_spec(self, fullname, path=None, target=None):  # noqa: ARG002
                raise AssertionError(f"Import hook invoked: {fullname}")

        before = set(sys.modules)
        out = io.StringIO()
        with patch.object(sys, "meta_path", [Trap()]), contextlib.redirect_stdout(out):
            index = self.scan()
        assert out.getvalue() == ""
        assert set(sys.modules) == before
        assert self.names(index) == ["stage2_danger", "stage2_danger.sub"]

    def test_first_concrete_package_shadows_later_package(self):
        self.write("a/pkg/__init__.py", '"""First."""\n')
        self.write("b/pkg/__init__.py", '"""Second."""\n')
        self.write("b/pkg/hidden.py")
        index = self.scan([self.root / "a", self.root / "b"])
        assert [(t.name, t.summary) for t in index.topics] == [("pkg", "First.")]

    def test_regular_package_overrides_earlier_namespace_portion(self):
        self.write("a/pkg/hidden.py")
        self.write("b/pkg/__init__.py")
        self.write("b/pkg/visible.py")
        assert self.names(self.scan([self.root / "a", self.root / "b"])) == ["pkg", "pkg.visible"]

    def test_namespace_portions_merge(self):
        self.write("a/space/one.py")
        self.write("b/space/two.py")
        assert self.names(self.scan([self.root / "a", self.root / "b"])) == [
            "space",
            "space.one",
            "space.two",
        ]

    def test_package_wins_over_same_directory_module(self):
        self.write("pkg.py")
        self.write("pkg/__init__.py", '"""Package wins."""\n')
        assert self.scan().topics[0].summary == "Package wins."

    def test_module_blocks_later_package(self):
        self.write("a/pkg.py")
        self.write("b/pkg/__init__.py")
        self.write("b/pkg/hidden.py")
        assert self.names(self.scan([self.root / "a", self.root / "b"])) == ["pkg"]

    def test_zip_and_prefix(self):
        archive = self.root / "library.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("prefix/zpkg/__init__.py", '"""ZIP package."""\nraise RuntimeError()\n')
            z.writestr("prefix/zpkg/tools.py", '"""Quasar ZIP utilities."""\n')
        index = self.scan([str(archive) + "/prefix"])
        assert self.names(index) == ["zpkg", "zpkg.tools"]
        assert [t.name for t in index.search("quasar")] == ["zpkg.tools"]

    def test_encoding_cookie_and_parenthesized_docstring(self):
        path = self.write("encoded.py")
        path.write_bytes(b'# coding: latin-1\n("""Caf\xe9 summary.""")\n')
        assert self.scan().topics[0].summary == "Café summary."

    def test_source_summary_does_not_leak_invalid_escape_warnings(self):
        self.write("escaped.py", r'"""Summary with \_ markup."""' + "\n")
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            summaries = [self.scan().topics[0].summary for _ in range(2)]
            # Indexing must also leave the user's warning policy intact.
            warnings.warn("User warning", SyntaxWarning, stacklevel=1)
        assert (summaries, [str(w.message) for w in captured]) == (
            [r"Summary with \_ markup."] * 2,
            ["User warning"],
        )

    def test_bytecode_name_without_importing(self):
        source = self.write(
            "byteonly.py", '"""Unavailable static synopsis."""\nraise RuntimeError()\n'
        )
        py_compile.compile(str(source), cfile=str(source.with_suffix(".pyc")), doraise=True)
        source.unlink()
        assert [(t.name, t.summary) for t in self.scan().topics] == [("byteonly", None)]

    def test_extension_file_and_builtin_names_without_summaries(self):
        from importlib.machinery import EXTENSION_SUFFIXES

        self.write("compiled" + EXTENSION_SUFFIXES[0], "")
        index = Discovery().build([self.root], builtins=("sys", "__main__"))
        assert [(t.name, t.summary) for t in index.topics] == [("compiled", None), ("sys", None)]

    def test_symlink_cycle_is_reported_and_terminates(self):
        self.write("pkg/__init__.py")
        (self.root / "pkg" / "cycle").symlink_to(self.root / "pkg", target_is_directory=True)
        index = self.scan()
        assert any("cycle" in d for d in index.diagnostics)
        assert len(index.topics) < 5

    def test_unreadable_source_keeps_name_and_reports_gap(self):
        self.write("unreadable.py")
        with patch.object(Path, "open", side_effect=PermissionError):
            index = self.scan()
        assert [(t.name, t.summary) for t in index.topics] == [("unreadable", None)]
        assert any("PermissionError" in d for d in index.diagnostics)

    def test_invalid_encoding_and_large_source_are_reported(self):
        p = self.write("broken.py")
        p.write_bytes(b'# coding: utf-8\n"""\xff"""\n')
        self.write("large.py", '"""Summary."""\n' + "#" * 100)
        index = Discovery(max_source_bytes=40).build([self.root], builtins=())
        assert len(index.diagnostics) == 2

    def test_location_budget_keeps_discovered_topics_and_reports_once(self):
        self.write("a.py")
        self.write("b/__init__.py")
        self.write("b/hidden.py")
        self.write("c/__init__.py")
        discovery = Discovery(max_locations=2)
        with self.assertLogs("positron.help_index", level="WARNING") as logs:
            index = discovery.build([self.root, self.root], builtins=("sys",))
        assert self.names(index) == ["a", "b", "sys"]
        assert [t.name for t in index.suggest("a")] == ["a"]
        assert [t.name for t in index.search("Quasar")] == ["a", "b"]
        assert discovery.visited == 2
        assert index.diagnostics == ("Discovery location budget exceeded; index is incomplete",)
        assert len(logs.records) == 1

    def test_location_budget_does_not_guess_unvisited_package_kind(self):
        self.write("a.py")
        self.write("pkg.py")
        self.write("pkg/__init__.py")
        discovery = Discovery(max_locations=1)
        with self.assertLogs("positron.help_index", level="WARNING"):
            index = discovery.build([self.root], builtins=())
        assert self.names(index) == ["a"]
        assert discovery.visited == 1

    def test_location_budget_omits_namespace_with_unvisited_shadowing_root(self):
        self.write("a/available.py")
        self.write("a/pkg/hidden.py")
        self.write("b/pkg/__init__.py")
        self.write("b/pkg/visible.py")
        discovery = Discovery(max_locations=2)
        with self.assertLogs("positron.help_index", level="WARNING"):
            index = discovery.build([self.root / "a", self.root / "b"], builtins=())
        assert self.names(index) == ["available"]
        assert discovery.visited == 2

    def test_location_budget_retains_fully_classified_namespace(self):
        self.write("space/unvisited.py")
        discovery = Discovery(max_locations=2)
        with self.assertLogs("positron.help_index", level="WARNING"):
            index = discovery.build([self.root], builtins=())
        assert [(topic.name, topic.kind) for topic in index.topics] == [("space", "namespace")]
        assert discovery.visited == 2

    def test_zero_location_budget_retains_builtins_and_loaded_modules(self):
        runtime = ModuleType("runtime_only", "Runtime summary.")
        discovery = Discovery(max_locations=0)
        with self.assertLogs("positron.help_index", level="WARNING"):
            index = discovery.build(
                [self.root],
                builtins=("sys",),
                loaded=snapshot_loaded_modules({"runtime_only": runtime}),
            )
        assert self.names(index) == ["runtime_only", "sys"]
        assert discovery.visited == 0

    def test_exact_location_budget_does_not_report_incomplete_index(self):
        self.write("a.py")
        discovery = Discovery(max_locations=1)
        index = discovery.build([self.root], builtins=())
        assert self.names(index) == ["a"]
        assert index.diagnostics == ()

    def test_location_budget_resets_for_each_build(self):
        self.write("a.py")
        discovery = Discovery(max_locations=1)
        for _ in range(2):
            with self.assertLogs("positron.help_index", level="WARNING") as logs:
                index = discovery.build([self.root, self.root], builtins=())
            assert self.names(index) == ["a"]
            assert len(index.diagnostics) == len(logs.records) == 1
        assert discovery.visited == 1

    def test_location_budget_keeps_zip_topics_and_closes_archives(self):
        archive = self.root / "library.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("a.py", '"""ZIP synopsis."""\n')
            z.writestr("pkg/__init__.py", "")
        discovery = Discovery(max_locations=1)
        with self.assertLogs("positron.help_index", level="WARNING"):
            index = discovery.build([archive], builtins=())
        assert self.names(index) == ["a"]
        assert index.topics[0].summary == "ZIP synopsis."
        assert discovery.archives == discovery.zip_children == {}

    def test_rescan_reflects_add_remove_update(self):
        a = self.write("old.py")
        assert self.names(self.scan()) == ["old"]
        a.unlink()
        self.write("new.py", '"""Updated."""\n')
        assert [(t.name, t.summary) for t in self.scan().topics] == [("new", "Updated.")]

    def test_suggestion_ranking_and_limit(self):
        for name in ["plot", "plotting", "a_plot"] + [f"plot{i:02}" for i in range(60)]:
            self.write(name + ".py")
        results = self.scan().suggest("plot", 100)
        assert len(results) == 50
        assert results[0].name == "plot"
        assert self.scan().suggest(" ") == ()

    def test_builtin_summary_gap_is_real(self):
        matches = []
        with patch.object(sys, "path", []), patch.object(sys, "builtin_module_names", ("sys",)):
            pydoc.ModuleScanner().run(lambda _p, n, _d: matches.append(n), "provides access")
        index = Discovery().build([], builtins=("sys",))
        assert matches == ["sys"]
        assert index.search("provides access") == ()
        assert self.names(index) == ["sys"]

    def test_runtime_extended_package_path_gap_is_real(self):
        with tempfile.TemporaryDirectory(prefix="help-dynamic-portion-") as other:
            Path(other, "extension.py").write_text('"""Extra module."""\n')
            self.write(
                "stage2_dynamic/__init__.py",
                f'"""Dynamic path package."""\n__path__.append({other!r})\n',
            )
            assert self.names(self.scan()) == ["stage2_dynamic"]
            assert [n for n, d in self.legacy()] == ["stage2_dynamic", "stage2_dynamic.extension"]

    def test_loaded_builtin_summary_is_recovered(self):
        loaded = snapshot_loaded_modules({"sys": sys})
        index = Discovery().build([], builtins=("sys",), loaded=loaded)
        assert [t.name for t in index.search("provides access")] == ["sys"]

    def test_loaded_dynamic_package_paths_recover_extra_modules(self):
        self.write("disk/pkg/__init__.py")
        self.write("disk/pkg/normal.py")
        self.write("extra/extension.py")
        module = ModuleType("pkg", "Loaded package synopsis.")
        module.__path__ = [str(self.root / "disk/pkg"), str(self.root / "extra")]
        loaded = snapshot_loaded_modules({"pkg": module})
        index = Discovery().build([self.root / "disk"], builtins=(), loaded=loaded)
        assert self.names(index) == ["pkg", "pkg.extension", "pkg.normal"]

    def test_snapshot_does_not_invoke_module_or_path_hooks(self):
        class GuardedModule(ModuleType):
            def __getattribute__(self, name):
                raise AssertionError("Attribute hook invoked")

        class GuardedPaths:
            def __iter__(self):
                raise AssertionError("Path iterator invoked")

        module = GuardedModule("guarded")
        namespace = ModuleType.__getattribute__(module, "__dict__")
        namespace.update(__doc__="Runtime synopsis.", __path__=GuardedPaths())
        before = set(sys.modules)
        snapshot = snapshot_loaded_modules(
            {"guarded": module, "invalid": object(), "missing": None}
        )
        assert set(sys.modules) == before
        assert snapshot.modules[0].summary == "Runtime synopsis."
        assert snapshot.modules[0].paths is None
        assert snapshot.diagnostics == ("Skipped custom loaded package path: guarded",)

    def test_snapshot_owns_immutable_metadata(self):
        module = ModuleType("pkg", "Before.")
        module.__path__ = ["before"]
        snapshot = snapshot_loaded_modules({"pkg": module})
        module.__doc__ = "After."
        module.__path__.append("after")
        assert (snapshot.modules[0].summary, snapshot.modules[0].paths) == ("Before.", ("before",))

    def test_loaded_package_overrides_different_disk_installation(self):
        self.write("disk/pkg/__init__.py")
        self.write("disk/pkg/wrong.py")
        self.write("actual/right.py")
        module = ModuleType("pkg", "Actual loaded package.")
        module.__path__ = [str(self.root / "actual")]
        index = Discovery().build(
            [self.root / "disk"], builtins=(), loaded=snapshot_loaded_modules({"pkg": module})
        )
        assert self.names(index) == ["pkg", "pkg.right"]

    def test_loaded_only_module_and_empty_package_path(self):
        self.write("pkg/__init__.py")
        self.write("pkg/hidden.py")
        pkg = ModuleType("pkg")
        pkg.__path__ = []
        runtime = ModuleType("pkg.runtime_only", "Runtime-only summary.")
        index = Discovery().build(
            [self.root],
            builtins=(),
            loaded=snapshot_loaded_modules({"pkg": pkg, "pkg.runtime_only": runtime}),
        )
        assert self.names(index) == ["pkg", "pkg.runtime_only"]
        assert [t.name for t in index.search("runtime-only summary")] == ["pkg.runtime_only"]

    def test_source_summary_kept_when_same_module_is_loaded(self):
        file = self.write("example.py", '"""Source synopsis."""\n')
        module = ModuleType("example", "Runtime replacement.")
        module.__file__ = str(file)
        index = Discovery().build(
            [self.root], builtins=(), loaded=snapshot_loaded_modules({"example": module})
        )
        assert index.topics[0].summary == "Source synopsis."


def test_cache_codec_import_during_cold_build_does_not_rescan(tmp_path, monkeypatch):
    source = tmp_path / "encoded.py"
    source.write_bytes(b'# coding: cp1258\n"""Encoded summary."""\n')
    monkeypatch.delitem(sys.modules, "encodings.cp1258", raising=False)
    monkeypatch.setattr(sys, "path", [str(tmp_path)])
    # Use real runtime snapshots, while excluding unrelated installed packages.
    original_snapshot = snapshot_loaded_modules
    monkeypatch.setattr(
        "positron.help_index.snapshot_loaded_modules",
        lambda: original_snapshot(
            {k: v for k, v in sys.modules.items() if k == "encodings.cp1258"}
        ),
    )
    cache = HelpIndex()
    cache.get()
    assert "encodings.cp1258" in sys.modules
    with patch.object(Discovery, "build", side_effect=AssertionError("Unexpected rebuild")):
        cache.update_context()
        assert cache.get().suggest("encoded")[0].summary == "Encoded summary."


def test_cache_import_and_runtime_metadata_do_not_walk(tmp_path, monkeypatch):
    package = tmp_path / "pkg"
    package.mkdir()
    (package / "__init__.py").write_text('"""Source synopsis."""\n')
    (package / "child.py").write_text('"""Child synopsis."""\n')
    registry = {}
    monkeypatch.setattr(sys, "path", [str(tmp_path)])
    monkeypatch.setattr(
        "positron.help_index.snapshot_loaded_modules", lambda: snapshot_loaded_modules(registry)
    )
    cache = HelpIndex()
    cache.get()
    module = ModuleType("pkg", "Runtime synopsis.")
    module.__file__ = str(package / "__init__.py")
    module.__path__ = [str(package)]
    with patch.object(Discovery, "build", side_effect=AssertionError("Unexpected rebuild")):
        registry["pkg"] = module
        cache.update_context()
        assert cache.get().suggest("pkg")[0].summary == "Source synopsis."
        runtime = ModuleType("pkg.runtime", "Runtime-only summary.")
        registry["pkg.runtime"] = runtime
        cache.update_context()
        assert cache.get().search("Runtime-only summary")[0].name == "pkg.runtime"
        runtime.__doc__ = "Changed runtime summary."
        cache.update_context()
        assert cache.get().search("Changed runtime")[0].name == "pkg.runtime"
        del registry["pkg.runtime"]
        cache.update_context()
        assert cache.get().suggest("pkg.runtime") == ()


def test_cache_dynamic_paths_refresh_without_rebuilding_static_index(tmp_path, monkeypatch):
    disk = tmp_path / "disk"
    package = disk / "pkg"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text("")
    (package / "wrong.py").write_text("")
    extra = tmp_path / "extra"
    extra.mkdir()
    (extra / "right.py").write_text('"""Dynamic source."""\n')
    module = ModuleType("pkg")
    module.__path__ = [str(extra)]
    registry = {}
    monkeypatch.setattr(sys, "path", [str(disk)])
    monkeypatch.setattr(
        "positron.help_index.snapshot_loaded_modules", lambda: snapshot_loaded_modules(registry)
    )
    cache = HelpIndex()
    cache.get()
    filesystem = cache._filesystem  # noqa: SLF001
    registry["pkg"] = module
    cache.update_context()
    assert [t.name for t in cache.get().suggest("pkg")] == ["pkg", "pkg.right"]
    with patch.object(Discovery, "build", side_effect=AssertionError("Unexpected rebuild")):
        module.__doc__ = "Updated package summary."
        cache.update_context()
        assert cache.get().suggest("pkg")[0].summary == "Updated package summary."
    (extra / "new.py").write_text('"""Added dynamic module."""\n')
    assert cache.get().suggest("pkg.new")
    assert cache._filesystem is filesystem  # noqa: SLF001
    module.__path__ = []
    cache.update_context()
    assert [t.name for t in cache.get().suggest("pkg")] == ["pkg"]
    del registry["pkg"]
    cache.update_context()
    assert cache.get().suggest("pkg.wrong")
    assert cache._package_indexes == {}  # noqa: SLF001


def test_cache_sys_path_changes_restore_precedence(tmp_path, monkeypatch):
    first, second = tmp_path / "first", tmp_path / "second"
    for root, summary in [(first, "First"), (second, "Second")]:
        root.mkdir()
        (root / "example.py").write_text(f'"""{summary}"""\n')
    monkeypatch.setattr(sys, "path", [str(first), str(second)])
    monkeypatch.setattr(
        "positron.help_index.snapshot_loaded_modules", lambda: snapshot_loaded_modules({})
    )
    cache = HelpIndex()
    assert cache.get().suggest("example")[0].summary == "First"
    sys.path.reverse()
    cache.update_context()
    assert cache.get().suggest("example")[0].summary == "Second"


def test_cache_loaded_module_blocks_static_package_children(tmp_path, monkeypatch):
    package = tmp_path / "pkg"
    package.mkdir()
    (package / "__init__.py").write_text("")
    (package / "child.py").write_text("")
    registry = {"pkg": ModuleType("pkg", "Loaded module.")}
    monkeypatch.setattr(sys, "path", [str(tmp_path)])
    monkeypatch.setattr(
        "positron.help_index.snapshot_loaded_modules", lambda: snapshot_loaded_modules(registry)
    )
    cache = HelpIndex()
    assert [t.name for t in cache.get().suggest("pkg")] == ["pkg"]
    registry.clear()
    cache.update_context()
    assert cache.get().suggest("pkg.child")


def test_cache_nested_loaded_paths_match_discovery(tmp_path, monkeypatch):
    for name in [
        "disk/pkg/__init__.py",
        "disk/pkg/sub/__init__.py",
        "disk/pkg/sub/old.py",
        "extra/sub/__init__.py",
        "extra/sub/other.py",
        "child/new.py",
    ]:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('"""Static summary."""\n')
    parent = ModuleType("pkg")
    parent.__path__ = [str(tmp_path / "extra")]
    child = ModuleType("pkg.sub")
    child.__path__ = [str(tmp_path / "disk/pkg/sub")]
    registry = {"pkg": parent, "pkg.sub": child}
    monkeypatch.setattr(sys, "path", [str(tmp_path / "disk")])
    monkeypatch.setattr(sys, "builtin_module_names", ())
    monkeypatch.setattr(
        "positron.help_index.snapshot_loaded_modules", lambda: snapshot_loaded_modules(registry)
    )
    cache = HelpIndex()
    for paths in [[str(tmp_path / "disk/pkg/sub")], [str(tmp_path / "child")], []]:
        child.__path__ = paths
        cache.update_context()
        expected = Discovery().build(
            sys.path, builtins=(), loaded=snapshot_loaded_modules(registry)
        )
        assert cache.get() == expected


def test_cache_zip_source_changes_and_loaded_path_reuse(tmp_path, monkeypatch):
    archive = tmp_path / "library.zip"

    def write(summary):
        with zipfile.ZipFile(archive, "w") as stream:
            stream.writestr("pkg/__init__.py", '"""ZIP package."""\n')
            stream.writestr("pkg/child.py", f'"""{summary}"""\n')

    write("Before")
    registry = {}
    monkeypatch.setattr(sys, "path", [str(archive)])
    monkeypatch.setattr(
        "positron.help_index.snapshot_loaded_modules", lambda: snapshot_loaded_modules(registry)
    )
    cache = HelpIndex()
    cache.get()
    package = ModuleType("pkg")
    package.__path__ = [str(archive / "pkg")]
    registry["pkg"] = package
    with patch.object(Discovery, "build", side_effect=AssertionError("Unexpected rebuild")):
        cache.update_context()
        assert cache.get().suggest("pkg.child")[0].summary == "Before"
    write("After ZIP update")
    assert cache.get().suggest("pkg.child")[0].summary == "After ZIP update"


if __name__ == "__main__":
    unittest.main()


def test_cache_detects_added_updated_and_removed_sources(tmp_path, monkeypatch):
    from positron.help_index import LoadedSnapshot

    monkeypatch.setattr(sys, "path", [str(tmp_path)])
    monkeypatch.setattr(
        "positron.help_index.snapshot_loaded_modules", lambda: LoadedSnapshot((), ())
    )
    cache = HelpIndex()
    first = cache.get()
    assert cache.get() is first
    source = tmp_path / "fresh_module.py"
    source.write_text('"""Initial summary."""\n')
    assert cache.get().suggest("fresh_module")[0].summary == "Initial summary."
    source.write_text('"""Replacement searchable synopsis."""\n')
    assert cache.get().search("Replacement searchable")[0].name == "fresh_module"
    source.unlink()
    assert cache.get().suggest("fresh_module") == ()


def test_snapshot_does_not_inspect_nonmodule_attributes():
    class Trap:
        def __getattribute__(self, _name):
            raise AssertionError("Module discovery must not inspect arbitrary objects")

    assert snapshot_loaded_modules({"trap": Trap()}).modules == ()


def test_cache_reuses_partial_index(tmp_path, monkeypatch, caplog):
    from positron.help_index import LoadedSnapshot

    (tmp_path / "available.py").write_text('"""Searchable partial result."""\n')
    (tmp_path / "unvisited").mkdir()
    monkeypatch.setattr(sys, "path", [str(tmp_path)])
    monkeypatch.setattr(
        "positron.help_index.snapshot_loaded_modules", lambda: LoadedSnapshot((), ())
    )
    with patch("positron.help_index.Discovery", side_effect=lambda: Discovery(max_locations=1)):
        cache = HelpIndex()
        first = cache.get()
        assert cache.get() is first
    assert [t.name for t in first.suggest("available")] == ["available"]
    assert [t.name for t in first.search("Searchable partial result")] == ["available"]
    assert len(first.diagnostics) == len(caplog.records) == 1
