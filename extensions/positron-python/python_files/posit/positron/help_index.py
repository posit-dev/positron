# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.

"""Find modules for Help suggestions and search, without importing them.

The modules are the built-in modules, the modules and packages on `sys.path`
with one level of their submodules, and every module that is already imported.
Deeper submodules of a package are listed only after the package is imported.
"""

from __future__ import annotations

import pkgutil
import sys
import tokenize
from pathlib import Path
from types import ModuleType
from typing import TypeGuard

# The latest listing of `sys.path`, and the key that it is valid for.
_listing: tuple[tuple, dict[str, pkgutil.ModuleInfo]] | None = None


def find_modules() -> dict[str, pkgutil.ModuleInfo | None]:
    """Map module names to where they were found on `sys.path`.

    The value is None for built-in modules and for imported modules that were
    not found on `sys.path`. Listing reads directories, but imports nothing.
    """
    modules: dict[str, pkgutil.ModuleInfo | None] = dict.fromkeys(sys.builtin_module_names)
    for name, info in _list_search_path().items():
        modules.setdefault(name, info)
    for name, module in sys.modules.copy().items():
        if _is_module(module) and _is_module_name(name):
            modules.setdefault(name, None)
    modules.pop("__main__", None)
    return modules


def suggest(query: str, limit: int) -> list[str]:
    """Return up to `limit` module names that contain `query`, best matches first.

    Exact matches come first, then prefix matches, then other matches. Within
    each group, public modules come before private ones (any part starts with
    "_"), and shallow modules before deep ones.
    """
    key = query.strip().lower()
    if not key:
        return []

    def rank(name: str):
        lower = name.lower()
        match = 0 if lower == key else 1 if lower.startswith(key) else 2
        private = any(part.startswith("_") for part in lower.split("."))
        return (match, private, lower.count("."), lower)

    return sorted((name for name in find_modules() if key in name.lower()), key=rank)[:limit]


def search(query: str) -> list[tuple[str, str | None]]:
    """Return the modules whose name or summary contains `query`, ignoring case.

    Each result is a module name and the first line of its docstring, if known.
    """
    key = query.lower()
    results = []
    for name, info in sorted(find_modules().items()):
        summary = _summary(name, info)
        if key in name.lower() or (summary is not None and key in summary.lower()):
            results.append((name, summary))
    return results


def _list_search_path() -> dict[str, pkgutil.ModuleInfo]:
    """List the modules on `sys.path`, with one level of submodules.

    Listing reads every package directory, which can take seconds on a network
    filesystem, so the listing is reused while each `sys.path` entry is unchanged.
    Installing or removing a package changes the entry that contains it. A
    submodule added to an existing package is listed after its entry changes.
    """
    global _listing
    path = _search_path()
    key = (tuple(path), tuple(_fingerprint(entry) for entry in path))
    if _listing is not None and _listing[0] == key:
        return _listing[1]
    modules: dict[str, pkgutil.ModuleInfo] = {}
    for info in pkgutil.iter_modules(path):
        modules.setdefault(info.name, info)
        directory = _package_directory(info)
        if directory is not None:
            for submodule in pkgutil.iter_modules([directory]):
                modules.setdefault(f"{info.name}.{submodule.name}", submodule)
    _listing = (key, modules)
    return modules


def _fingerprint(entry: str) -> tuple | None:
    try:
        info = Path(entry).stat()
    except OSError:
        return None
    return (info.st_mtime_ns, info.st_ctime_ns, info.st_ino)


def _search_path() -> list[str]:
    """The `sys.path` entries to list, without the home directory.

    The working directory is often the home directory, and listing it opens every
    folder in it, such as Documents and Desktop. On macOS that asks the user for
    permission to read those folders.
    """
    home = Path("~").expanduser().resolve()
    return [entry for entry in sys.path if isinstance(entry, str) and Path(entry).resolve() != home]


def _summary(name: str, info: pkgutil.ModuleInfo | None) -> str | None:
    """The first line of a module's docstring, without importing the module."""
    module = sys.modules.get(name)
    if _is_module(module):
        # Read the module's own dictionary, so that no module code runs.
        doc = ModuleType.__getattribute__(module, "__dict__").get("__doc__")
        return _first_line(doc) if isinstance(doc, str) else None
    source = _source_file(info)
    return _source_summary(source) if source is not None else None


def _source_summary(path: Path) -> str | None:
    """The first line of the docstring in a source file, read without running it.

    Reading stops at the first token that is not a comment or a blank line.
    Escape sequences are shown as they are written in the file.
    """
    try:
        with path.open("rb") as stream:
            encoding, first_lines = tokenize.detect_encoding(stream.readline)
            lines = iter(first_lines)

            def readline() -> str:
                line = next(lines, None)
                return (stream.readline() if line is None else line).decode(encoding)

            for token in tokenize.generate_tokens(readline):
                if token.type == tokenize.STRING:
                    text = token.string.lstrip("rRbBuU")
                    quote = text[:3] if text[:3] in ('"""', "'''") else text[:1]
                    return _first_line(text[len(quote) : -len(quote)])
                if token.type not in (tokenize.COMMENT, tokenize.NL):
                    return None
    except (OSError, SyntaxError, UnicodeError, tokenize.TokenError):
        return None
    return None


def _source_file(info: pkgutil.ModuleInfo | None) -> Path | None:
    """The source file of a module found in a directory, if it has one."""
    directory = getattr(info.module_finder, "path", None) if info is not None else None
    if info is None or not isinstance(directory, str):
        return None
    if info.ispkg:
        path = Path(directory, info.name, "__init__.py")
    else:
        path = Path(directory, info.name + ".py")
    return path if path.is_file() else None


def _package_directory(info: pkgutil.ModuleInfo) -> str | None:
    """The directory of a package found in a directory, to list its submodules."""
    directory = getattr(info.module_finder, "path", None)
    if not info.ispkg or not isinstance(directory, str):
        return None
    return str(Path(directory, info.name))


def _first_line(text: str) -> str | None:
    return text.strip().split("\n")[0].strip() or None


def _is_module(value: object) -> TypeGuard[ModuleType]:
    # Check the real type: some objects in `sys.modules` (such as cffi's `Lib`)
    # report ModuleType as their `__class__` without being modules.
    return issubclass(type(value), ModuleType)


def _is_module_name(name: object) -> bool:
    return isinstance(name, str) and all(part.isidentifier() for part in name.split("."))
