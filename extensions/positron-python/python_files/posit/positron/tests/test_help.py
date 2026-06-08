#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import json
import pydoc
import sys
import types
from typing import Any
from unittest.mock import Mock
from urllib.request import urlopen

import numpy as np
import pandas as pd
import pytest

from positron.help import HelpService, _locatable_key, help  # noqa: A004
from positron.help_comm import HelpBackendRequest, HelpFrontendEvent, ShowHelpKind

from .conftest import DummyComm
from .utils import json_rpc_notification, json_rpc_request, json_rpc_response

try:
    import torch
except ImportError:
    torch = None

TARGET_NAME = "target_name"


@pytest.fixture
def help_service() -> HelpService:
    """A Positron help service."""
    return HelpService()


@pytest.fixture
def running_help_service(help_service: HelpService):
    help_service.start()
    yield help_service
    help_service.shutdown()


@pytest.fixture
def help_comm(help_service: HelpService):
    """Open a dummy comm for the help service."""
    # Open a comm
    help_comm = DummyComm(TARGET_NAME)
    help_service.on_comm_open(help_comm, {})
    assert help_service._comm is not None, "Comm was not created"  # noqa: SLF001

    # Clear messages due to the comm_open
    help_comm.messages.clear()

    return help_service._comm  # noqa: SLF001


@pytest.fixture
def mock_pydoc_thread(help_service, monkeypatch):
    mock_pydoc_thread = Mock()
    mock_pydoc_thread.url = "http://localhost:1234/"
    monkeypatch.setattr(help_service, "_pydoc_thread", mock_pydoc_thread)
    return mock_pydoc_thread


def test_pydoc_server_starts_and_shuts_down(running_help_service: HelpService):
    help_service = running_help_service

    assert help_service._pydoc_thread is not None  # noqa: SLF001
    assert help_service._pydoc_thread.serving  # noqa: SLF001

    help_service.shutdown()

    assert not help_service._pydoc_thread.serving  # noqa: SLF001


def test_pydoc_server_styling(running_help_service: HelpService):
    """We should pydoc should apply css styling."""
    help_service = running_help_service

    assert help_service._pydoc_thread is not None  # noqa: SLF001

    key = "pandas.read_csv"
    url = f"{help_service._pydoc_thread.url}get?key={key}"  # noqa: SLF001
    with urlopen(url) as f:
        html = f.read().decode("utf-8")

    # Html should include stylesheet if added correctly
    assert '<link rel="stylesheet" type="text/css" href="_pydoc.css"' in html

    # There should no longer be any hot pink!
    assert "#ee77aa" not in html


def show_help_event(content: str, kind=ShowHelpKind.Url, *, focus=True):
    return json_rpc_notification(
        HelpFrontendEvent.ShowHelp.value, {"kind": kind, "focus": focus, "content": content}
    )


@pytest.mark.parametrize(
    ("obj", "expected_path"),
    [
        (print, "print"),
        #
        # Not sure why, but pydoc fails to import DataFrame from pandas.core.frame,
        # but succeeds at importing from pandas.
        (pd.DataFrame, "pandas.DataFrame"),
        (pd.DataFrame(), "pandas.DataFrame"),
        ("pandas.core.frame.DataFrame", "pandas.DataFrame"),
        (pd.DataFrame.merge, "pandas.DataFrame.merge"),
        (pd.Series, "pandas.Series"),
        #
        (0, "int"),
        (int, "int"),
        # A module
        (np, "numpy"),
        # Numpy ufuncs
        (np.abs, "numpy.absolute"),
        # getset_descriptors
        (np.float32.base, "numpy.generic.base"),
        # Keywords should resolve even though they aren't objects.
        ("async", "async"),
        # The overrided help function should resolve.
        (help, "positron.help.help"),
    ],
)
def test_show_help(
    obj: Any, expected_path: str, help_service: HelpService, help_comm, mock_pydoc_thread
):
    """Calling `show_help` should resolve an object to a url and send a `ShowHelp` event over the comm."""
    help_service.show_help(obj)

    assert help_comm.messages == [
        show_help_event(f"{mock_pydoc_thread.url}get?key={expected_path}")
    ]


@pytest.mark.parametrize(
    ("raw", "canonical"),
    [
        ("scikit-learn", "scikit-learn"),
        ("scikit_learn", "scikit-learn"),
        ("Scikit_Learn", "scikit-learn"),
        ("python.dateutil", "python-dateutil"),
        ("Pillow", "pillow"),
        ("already-canonical", "already-canonical"),
    ],
)
def test_canonicalize_distribution_name(raw: str, canonical: str) -> None:
    """PEP 503 normalization collapses runs of -_. and lowercases."""
    from positron.help import _canonicalize_distribution_name

    assert _canonicalize_distribution_name(raw) == canonical


@pytest.mark.parametrize(
    ("dist_name", "packages_map", "expected_first", "expected_set"),
    [
        # PyPI dist "scikit-learn" -> import "sklearn".
        ("scikit-learn", {"sklearn": ["scikit-learn"]}, "sklearn", {"sklearn"}),
        # PEP 503 variants of the dist name still match.
        ("Scikit_Learn", {"sklearn": ["scikit-learn"]}, "sklearn", {"sklearn"}),
        # When a dist exposes multiple top-levels, the module whose canonical
        # name matches the dist is sorted first.
        (
            "setuptools",
            {
                "_distutils_hack": ["setuptools"],
                "setuptools": ["setuptools"],
                "pkg_resources": ["setuptools"],
            },
            "setuptools",
            {"_distutils_hack", "setuptools", "pkg_resources"},
        ),
        # Unknown dist returns empty.
        ("nonexistent-dist", {"sklearn": ["scikit-learn"]}, None, set()),
    ],
    ids=["differs", "canonical-variants", "multi-top-level-preferred", "unknown"],
)
def test_distribution_to_modules(
    monkeypatch: pytest.MonkeyPatch,
    dist_name: str,
    packages_map: dict,
    expected_first,
    expected_set: set,
) -> None:
    """Map distribution names to their top-level importable modules."""
    import importlib.metadata

    from positron.help import _distribution_to_modules

    # `raising=False` -- packages_distributions doesn't exist on Python < 3.10,
    # but our code imports it lazily; we just need the attribute present for
    # the test's mocked dispatch.
    monkeypatch.setattr(
        importlib.metadata,
        "packages_distributions",
        lambda: packages_map,
        raising=False,
    )

    result = _distribution_to_modules(dist_name)
    assert (result[0] if result else None, set(result)) == (expected_first, expected_set)


def test_distribution_to_modules_missing_api(monkeypatch: pytest.MonkeyPatch) -> None:
    """On Python < 3.10 (no packages_distributions) we gracefully return []."""
    import importlib.metadata

    from positron.help import _distribution_to_modules

    monkeypatch.delattr(importlib.metadata, "packages_distributions", raising=False)

    assert _distribution_to_modules("scikit-learn") == []


def test_show_help_resolves_distribution_name(
    help_service: HelpService,
    help_comm,
    mock_pydoc_thread,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When pydoc can't resolve a name, fall back via the distribution mapping."""
    import importlib.metadata

    # numpy is a real module; pretend it's shipped as the dist "fake-dist".
    # `raising=False` so this works on Python 3.9 where the attribute is absent.
    monkeypatch.setattr(
        importlib.metadata,
        "packages_distributions",
        lambda: {"numpy": ["fake-dist"]},
        raising=False,
    )

    help_service.show_help("fake-dist")

    assert help_comm.messages == [show_help_event(f"{mock_pydoc_thread.url}get?key=numpy")]


def test_locatable_key_keeps_a_key_that_already_resolves() -> None:
    """A key that already resolves to the object is returned unchanged."""
    assert _locatable_key("builtins.len", len) == "builtins.len"


def test_locatable_key_falls_back_to_module_path() -> None:
    """An unresolvable key falls back to the object's public module path.

    This mirrors torch, whose callables carry an internal __qualname__
    (torch._VariableFunctionsClass.abs) but are reachable at torch.abs.
    """
    # json.dumps is reachable at json.dumps; the internal-looking key is not.
    assert _locatable_key("json._InternalEncoder.dumps", json.dumps) == "json.dumps"


def test_locatable_key_falls_back_to_top_level_package() -> None:
    """When the full module path doesn't resolve, fall back to the top-level package.

    This mirrors tensorflow, whose callables report an internal __module__
    (tensorflow.python.ops.math_ops) but are reachable at tensorflow.abs.
    """
    package = types.ModuleType("positron_fake_pkg")

    def op():
        """A fake op exposed at the package top level."""

    op.__module__ = "positron_fake_pkg.internal.ops"
    op.__name__ = "op"
    setattr(package, "op", op)  # noqa: B010
    sys.modules["positron_fake_pkg"] = package
    try:
        # The internal module path can't be imported, but the top-level package re-exports `op`.
        result = _locatable_key("positron_fake_pkg.internal.ops._Internal.op", op)
        assert result == "positron_fake_pkg.op"
    finally:
        sys.modules.pop("positron_fake_pkg", None)


def test_locatable_key_rejects_a_name_that_resolves_to_a_different_object() -> None:
    """The fallback is only accepted when it resolves back to the same object."""

    def impostor(x):
        """Not the builtin len."""

    impostor.__module__ = "builtins"
    impostor.__name__ = "len"
    # `builtins.len` resolves, but to the builtin rather than our impostor, so the original
    # (unresolvable) key is kept instead of silently substituting an unrelated object.
    assert _locatable_key("nonexistent.module.len", impostor) == "nonexistent.module.len"


def test_locatable_key_survives_locate_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    """A `pydoc.locate` that raises during import degrades to the original key.

    `pydoc.locate` re-raises errors hit while importing a module along the path, so resolving a
    key must never let that propagate and crash the help request.
    """

    def boom(_path: str) -> Any:
        raise pydoc.ErrorDuringImport("exploding module", sys.exc_info())

    monkeypatch.setattr(pydoc, "locate", boom)
    assert _locatable_key("anything.at.all", len) == "anything.at.all"


@pytest.mark.skipif(torch is None, reason="torch not available")
def test_show_help_renders_torch_function(running_help_service: HelpService) -> None:
    """help(torch.abs) renders documentation rather than a "Not found" error (#7416).

    torch.abs carries an internal __qualname__ (torch._VariableFunctionsClass.abs) that
    pydoc.locate() can't resolve; the resolver should rewrite it to the public torch.abs.
    """
    assert torch is not None  # narrow the optional import for the type checker
    help_service = running_help_service
    help_comm = DummyComm(TARGET_NAME)
    help_service.on_comm_open(help_comm, {})
    help_comm.messages.clear()

    help_service.show_help(torch.abs)

    assert len(help_comm.messages) == 1
    url = help_comm.messages[0]["data"]["params"]["content"]
    assert "get?key=torch.abs" in url

    with urlopen(url) as f:
        html = f.read().decode("utf-8")
    assert "Not found" not in html


def test_handle_show_help_topic(help_comm, mock_pydoc_thread) -> None:
    msg = json_rpc_request(
        HelpBackendRequest.ShowHelpTopic, {"topic": "logging"}, comm_id="dummy_comm_id"
    )
    help_comm.handle_msg(msg)

    assert help_comm.messages == [
        json_rpc_response(result=True),
        show_help_event(f"{mock_pydoc_thread.url}get?key=logging"),
    ]
