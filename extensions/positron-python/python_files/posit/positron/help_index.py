# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.

"""Import-free discovery for Help suggestions and module-summary search.

Filesystem and ZIP discovery approximates standard path-based importing only.
It deliberately does not run custom import hooks or package initialization.
"""

from __future__ import annotations

import ast
import io
import logging
import os
import sys
import tokenize
import warnings
import zipfile
from bisect import bisect_left
from dataclasses import dataclass
from importlib.machinery import BYTECODE_SUFFIXES, EXTENSION_SUFFIXES, SOURCE_SUFFIXES
from pathlib import Path
from threading import RLock
from types import ModuleType

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LoadedModule:
    name: str
    summary: str | None
    origin: str
    is_package: bool
    paths: tuple[str, ...] | None


@dataclass(frozen=True)
class LoadedSnapshot:
    modules: tuple[LoadedModule, ...]
    diagnostics: tuple[str, ...]


def snapshot_loaded_modules(modules=None) -> LoadedSnapshot:
    """Capture on the interpreter thread; pass only immutable values to workers.

    Bypass module __getattr__/__getattribute__, lazy loaders, and custom path
    iterators. Never inspect functions, properties, or user-defined attributes.
    """
    source = sys.modules if modules is None else modules
    if type(source) is not dict:
        raise TypeError("Expected an ordinary module registry dictionary")
    result = []
    diagnostics = []
    for name, module in source.copy().items():
        if (
            type(name) is not str
            or name == "__main__"
            or not all(p.isidentifier() for p in name.split("."))
        ):
            continue
        if not issubclass(type(module), ModuleType):
            continue
        namespace = ModuleType.__getattribute__(module, "__dict__")
        doc = namespace.get("__doc__")
        summary = doc.split("\n", 1)[0] if type(doc) is str else None
        origin = namespace.get("__file__")
        origin = origin if type(origin) is str else "already loaded"
        is_package = "__path__" in namespace
        paths = namespace.get("__path__")
        if is_package:
            if type(paths) in (list, tuple):
                copied = tuple(paths)
                paths = copied if all(type(p) is str for p in copied) else None
            else:
                paths = None
            if paths is None:
                diagnostics.append(f"Skipped custom loaded package path: {name}")
        else:
            paths = None
        result.append(LoadedModule(name, summary, origin, is_package, paths))
    return LoadedSnapshot(tuple(sorted(result, key=lambda m: m.name)), tuple(diagnostics))


@dataclass(frozen=True)
class Topic:
    name: str
    kind: str
    origin: str
    summary: str | None


@dataclass(frozen=True)
class Index:
    topics: tuple[Topic, ...]
    diagnostics: tuple[str, ...]

    def search(self, query: str) -> tuple[Topic, ...]:
        key = query.lower()
        return tuple(t for t in self.topics if key in f"{t.name} - {t.summary or ''}".lower())

    def suggest(self, query: str, limit: int = 50) -> tuple[Topic, ...]:
        key = query.strip().lower()
        if not key:
            return ()
        matches = (t for t in self.topics if key in t.name.lower())

        def rank(topic):
            name = topic.name.lower()
            return (0 if name == key else 1 if name.startswith(key) else 2, name)

        return tuple(sorted(matches, key=rank)[: max(0, min(limit, 50))])


def _overlay_metadata(topics, loaded: LoadedSnapshot) -> None:
    # Add loaded-only modules and their runtime summaries after traversal.
    for module in loaded.modules:
        previous = topics.get(module.name)
        # Keep an existing source synopsis when it belongs to the same file.
        # Otherwise the already-loaded object is the relevant help target.
        same_source = previous is not None and previous.origin == module.origin
        summary = (
            previous.summary
            if previous is not None and same_source and previous.summary is not None
            else module.summary
        )
        kind = (
            previous.kind
            if previous and previous.kind == "builtin"
            else ("package" if module.is_package else "module")
        )
        topics[module.name] = Topic(module.name, kind, module.origin, summary)


@dataclass(frozen=True)
class Location:
    path: Path
    archive: zipfile.ZipFile | None = None
    prefix: str = ""
    ancestors: frozenset[str] = frozenset()

    def child(self, name: str) -> Location:
        if self.archive:
            return Location(self.path, self.archive, self.prefix + name + "/")
        return Location(self.path / name, ancestors=self.ancestors | {str(self.path.resolve())})

    def origin(self, filename: str) -> str:
        if self.archive:
            return f"{self.path}!/{self.prefix}{filename}"
        return str(self.path / filename)


class Discovery:
    def __init__(self, max_locations: int = 100_000, max_source_bytes: int = 1_048_576):
        self.max_locations = max_locations
        self.max_source_bytes = max_source_bytes
        self.diagnostics: list[str] = []
        self.visited = 0
        self.budget_exhausted = False
        self.archives: dict[Path, zipfile.ZipFile] = {}
        self.zip_children: dict[Path, dict[str, dict[str, bool]]] = {}
        self.fingerprints: dict[Path, tuple | None] = {}
        self.package_paths: dict[str, tuple[str, ...]] = {}

    def build(self, paths, builtins=None, loaded: LoadedSnapshot | None = None) -> Index:
        self.diagnostics = []
        self.visited = 0
        self.budget_exhausted = False
        topics = {}
        for name in sys.builtin_module_names if builtins is None else builtins:
            if name != "__main__":
                topics[name] = Topic(name, "builtin", "builtin", None)
        try:
            roots = [loc for path in paths if (loc := self.root(path)) is not None]
            self.walk(roots, "", topics, 0)
            if loaded is not None:
                self.enrich(topics, loaded)
            return Index(tuple(topics[n] for n in sorted(topics)), tuple(self.diagnostics))
        finally:
            for archive in self.archives.values():
                archive.close()
            self.archives.clear()
            self.zip_children.clear()

    def enrich(self, topics, loaded):
        self.diagnostics.extend(loaded.diagnostics)
        # Runtime package locations supersede disk-only guesses. Parents first,
        # so a loaded child can then replace its own subtree independently.
        for module in sorted(loaded.modules, key=lambda m: (m.name.count("."), m.name)):
            if module.is_package and module.paths is None:
                continue
            prefix = module.name + "."
            for name in tuple(topics):
                if name.startswith(prefix):
                    del topics[name]
            if module.is_package:
                roots = [loc for path in module.paths if (loc := self.root(path)) is not None]
                self.walk(roots, prefix, topics, module.name.count(".") + 1)
        _overlay_metadata(topics, loaded)

    def root(self, value) -> Location | None:
        path = Path(value or Path.cwd()).absolute()
        self.track(path)
        if path.is_dir():
            return Location(path)
        # Supports sys.path entries such as /path/library.zip/subdirectory.
        for candidate in (path, *path.parents):
            if candidate.is_file():
                self.track(candidate)
                try:
                    if candidate not in self.archives:
                        archive = zipfile.ZipFile(candidate)
                        self.archives[candidate] = archive
                        children = {}
                        for entry in archive.infolist():
                            parts = entry.filename.rstrip("/").split("/")
                            if any(p in ("", ".", "..") for p in parts):
                                continue
                            for i, name in enumerate(parts):
                                prefix = "/".join(parts[:i]) + ("/" if i else "")
                                directory = i < len(parts) - 1 or entry.is_dir()
                                children.setdefault(prefix, {})[name] = directory
                        self.zip_children[candidate] = children
                    suffix = path.relative_to(candidate).as_posix()
                    return Location(
                        candidate, self.archives[candidate], "" if suffix == "." else suffix + "/"
                    )
                except (OSError, zipfile.BadZipFile) as exc:
                    self.diagnostics.append(f"Unsupported search path {path}: {type(exc).__name__}")
                    return None
        return None  # Nonexistent sys.path entries are normal.

    def entries(self, loc: Location) -> dict[str, bool] | None:
        if self.visited >= self.max_locations:
            if not self.budget_exhausted:
                diagnostic = "Discovery location budget exceeded; index is incomplete"
                self.diagnostics.append(diagnostic)
                logger.warning(diagnostic)
                self.budget_exhausted = True
            return None
        self.visited += 1
        if loc.archive:
            return self.zip_children[loc.path].get(loc.prefix, {})
        if str(loc.path.resolve()) in loc.ancestors:
            self.diagnostics.append(f"Skipped directory cycle: {loc.path}")
            return {}
        self.track(loc.path)
        try:
            with os.scandir(loc.path) as entries:
                return {e.name: e.is_dir() for e in entries}
        except OSError as exc:
            self.diagnostics.append(f"Cannot enumerate {loc.path}: {type(exc).__name__}")
            return {}

    def suffixes(self, loc):
        # ZIP import supports source/bytecode, but not extension binaries.
        return ([] if loc.archive else EXTENSION_SUFFIXES) + SOURCE_SUFFIXES + BYTECODE_SUFFIXES

    def module_files(self, entries, loc):
        files = {}
        for suffix in self.suffixes(loc):
            for filename, directory in entries.items():
                if not directory and filename.endswith(suffix):
                    name = filename[: -len(suffix)]
                    if name.isidentifier() and name != "__init__":
                        files.setdefault(name, filename)
        return files

    def walk(self, locations, prefix, topics, depth):
        if depth > 32:
            self.diagnostics.append(f"Skipped excessive depth at {prefix}")
            return
        concrete = {}
        namespaces = {}
        locations_complete = True
        for loc in locations:
            entries = self.entries(loc)
            if entries is None:
                locations_complete = False
                break
            files = self.module_files(entries, loc)
            directories = {
                n
                for n, directory in entries.items()
                if directory and n.isidentifier() and n != "__pycache__"
            }
            for name in sorted(directories | files.keys()):
                if name in concrete or prefix + name in topics:
                    continue
                child = loc.child(name) if name in directories else None
                child_entries = self.entries(child) if child else {}
                if child_entries is None:
                    locations_complete = False
                    # Do not guess whether an unvisited directory is a package
                    # or namespace, or fall back to a same-named module.
                    break
                init = next(
                    (
                        "__init__" + s
                        for s in self.suffixes(loc)
                        if child_entries.get("__init__" + s) is False
                    ),
                    None,
                )
                if init:
                    concrete[name] = (child, init, True)
                elif name in files:
                    concrete[name] = (loc, files[name], False)
                elif child:
                    namespaces.setdefault(name, []).append(child)
        for name, (loc, filename, package) in sorted(concrete.items()):
            full = prefix + name
            topics[full] = Topic(
                full,
                "package" if package else "module",
                loc.origin(filename),
                self.summary(loc, filename),
            )
            if package:
                self.package_paths[full] = (str(loc.path / loc.prefix),)
                self.walk([loc], full + ".", topics, depth + 1)
        # A later, unvisited location might contain a concrete package/module
        # that shadows a namespace portion found earlier in the search path.
        if not locations_complete:
            return
        for name, portions in sorted(namespaces.items()):
            if name not in concrete and prefix + name not in topics:
                full = prefix + name
                topics[full] = Topic(
                    full, "namespace", ";".join(p.origin("") for p in portions), None
                )
                self.package_paths[full] = tuple(str(p.path / p.prefix) for p in portions)
                self.walk(portions, full + ".", topics, depth + 1)

    def summary(self, loc, filename):
        if not any(filename.endswith(s) for s in SOURCE_SUFFIXES):
            return None
        if not loc.archive:
            self.track(loc.path / filename)
        try:
            with (
                loc.archive.open(loc.prefix + filename)
                if loc.archive
                else (loc.path / filename).open("rb")
            ) as stream:
                data = stream.read(self.max_source_bytes + 1)
            if len(data) > self.max_source_bytes:
                self.diagnostics.append(
                    f"Source summary exceeds size limit: {loc.origin(filename)}"
                )
                return None
            encoding, _ = tokenize.detect_encoding(io.BytesIO(data).readline)
            return _source_summary(data.decode(encoding))
        except (
            OSError,
            SyntaxError,
            UnicodeError,
            ValueError,
            zipfile.BadZipFile,
            RuntimeError,
        ) as exc:
            self.diagnostics.append(
                f"Cannot read summary {loc.origin(filename)}: {type(exc).__name__}"
            )
            return None

    def track(self, path: Path) -> None:
        self.fingerprints[path] = _fingerprint(path)


def _source_summary(source: str) -> str | None:
    """Read the first string expression without executing or parsing the module body."""
    parts = []
    try:
        for token in tokenize.generate_tokens(io.StringIO(source).readline):
            if token.type == tokenize.STRING or (
                token.type == tokenize.OP and token.string in ("(", ")")
            ):
                parts.append(token.string)
            elif token.type == tokenize.NEWLINE:
                # Reading installed documentation must not emit compiler warnings
                # into the user's console. Older Python versions use DeprecationWarning.
                with warnings.catch_warnings():
                    warnings.filterwarnings(
                        "ignore", message=".*invalid escape sequence", category=SyntaxWarning
                    )
                    warnings.filterwarnings(
                        "ignore", message=".*invalid escape sequence", category=DeprecationWarning
                    )
                    value = ast.literal_eval("".join(parts))
                return value.strip().split("\n")[0].strip() if isinstance(value, str) else None
            elif token.type not in (tokenize.COMMENT, tokenize.NL):
                return None
    except (tokenize.TokenError, SyntaxError, ValueError):
        return None
    return None


def _fingerprint(path: Path) -> tuple | None:
    try:
        info = path.stat()
        return (info.st_mtime_ns, info.st_ctime_ns, info.st_size, info.st_mode)
    except OSError:
        return None


class HelpIndex:
    """Share a filesystem index with the HTTP thread without inspecting live objects there.

    Call update_context on the interpreter thread before requesting suggestions or
    navigating to search results. The server consumes only immutable snapshots.
    Source/directory/ZIP metadata detects changes without re-reading every source.
    Unloaded runtime-only documentation and custom import hooks remain unsupported.
    """

    def __init__(self):
        self._lock = RLock()
        self._index: Index | None = None
        self._filesystem: Index | None = None
        self._fingerprints: dict[Path, tuple | None] = {}
        self._package_paths: dict[str, tuple[str, ...]] = {}
        self._package_indexes: dict[tuple[str, ...], tuple[Index, dict]] = {}
        self._context: tuple = ()
        self.update_context()

    def update_context(self) -> None:
        paths = tuple(str(Path(p).absolute()) for p in sys.path if type(p) is str)
        context = (paths, snapshot_loaded_modules())
        with self._lock:
            if not self._context or paths != self._context[0]:
                self._filesystem = None
                self._package_indexes.clear()
            if context != self._context:
                self._context = context
                self._index = None

    @staticmethod
    def _changed(fingerprints) -> bool:
        return any(_fingerprint(path) != value for path, value in fingerprints.items())

    def get(self) -> Index:
        with self._lock:
            paths, loaded = self._context
            if self._filesystem is None or self._changed(self._fingerprints):
                discovery = Discovery()
                self._filesystem = discovery.build(paths)
                self._fingerprints = discovery.fingerprints
                self._package_paths = discovery.package_paths
                self._index = None
            # Only runtime paths absent from the static tree need discovery. Cache
            # these separately: importing a package with its ordinary __path__
            # must not walk that package again, nor invalidate the main index.
            active_paths = {
                tuple(str(Path(p).absolute()) for p in module.paths)
                for module in loaded.modules
                if module.is_package
                and module.paths is not None
                and tuple(str(Path(p).absolute()) for p in module.paths)
                != self._package_paths.get(module.name)
            }
            self._package_indexes = {
                key: value for key, value in self._package_indexes.items() if key in active_paths
            }
            for package_paths in active_paths:
                cached = self._package_indexes.get(package_paths)
                if cached is None or self._changed(cached[1]):
                    discovery = Discovery()
                    index = (
                        discovery.build(package_paths, builtins=())
                        if package_paths
                        else Index((), ())
                    )
                    self._package_indexes[package_paths] = (index, discovery.fingerprints)
                    self._index = None
            if self._index is None:
                self._index = self._overlay(loaded)
            return self._index

    def _overlay(self, loaded: LoadedSnapshot) -> Index:
        """Apply immutable runtime metadata without walking or reading sources."""
        assert self._filesystem is not None
        topics = {topic.name: topic for topic in self._filesystem.topics}
        names = tuple(topics)
        children: dict[str, set[str]] = {}

        def add(topic):
            topics[topic.name] = topic
            parent = topic.name.rpartition(".")[0]
            children.setdefault(parent, set()).add(topic.name)

        def remove_children(name):
            pending = list(children.pop(name, ()))
            while pending:
                child = pending.pop()
                pending.extend(children.pop(child, ()))
                topics.pop(child, None)

        for topic in self._filesystem.topics:
            add(topic)
        diagnostics = list(self._filesystem.diagnostics) + list(loaded.diagnostics)
        for module in sorted(loaded.modules, key=lambda m: (m.name.count("."), m.name)):
            if module.is_package and module.paths is None:
                continue
            remove_children(module.name)
            if not module.is_package:
                continue
            assert module.paths is not None
            package_paths = tuple(str(Path(p).absolute()) for p in module.paths)
            prefix = module.name + "."
            if package_paths == self._package_paths.get(module.name):
                start = bisect_left(names, prefix)
                for offset in range(start, len(self._filesystem.topics)):
                    topic = self._filesystem.topics[offset]
                    if not topic.name.startswith(prefix):
                        break
                    add(topic)
            else:
                index, _ = self._package_indexes[package_paths]
                diagnostics.extend(index.diagnostics)
                for topic in index.topics:
                    add(Topic(prefix + topic.name, topic.kind, topic.origin, topic.summary))
        _overlay_metadata(topics, loaded)
        return Index(tuple(topics[name] for name in sorted(topics)), tuple(diagnostics))
