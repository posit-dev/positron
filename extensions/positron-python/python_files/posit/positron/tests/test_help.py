#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from typing import Any
from unittest.mock import Mock
from urllib.request import urlopen

import numpy as np
import pandas as pd
import pytest

from positron.help import HelpService, help  # noqa: A004
from positron.help_comm import HelpBackendRequest, HelpFrontendEvent, ShowHelpKind

from .conftest import DummyComm
from .utils import json_rpc_notification, json_rpc_request, json_rpc_response

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


def test_show_help_renders_objects_with_internal_module_paths(
    running_help_service: HelpService,
) -> None:
    """Renders help for objects whose __module__ points to an internal path."""
    from urllib.request import urlopen

    def fake_abs(x):
        """Compute the absolute value."""

    fake_abs.__module__ = "tensorflow.python.ops.math_ops"
    fake_abs.__qualname__ = "abs"

    help_service = running_help_service
    help_comm = DummyComm(TARGET_NAME)
    help_service.on_comm_open(help_comm, {})
    help_comm.messages.clear()

    help_service.show_help(fake_abs)

    assert len(help_comm.messages) == 1
    event = help_comm.messages[0]
    url = event["data"]["params"]["content"]
    assert "get?key=tensorflow.python.ops.math_ops.abs" in url

    with urlopen(url) as f:
        html = f.read().decode("utf-8")
    assert "Not found" not in html
    assert "Compute the absolute value" in html


def test_handle_show_help_topic(help_comm, mock_pydoc_thread) -> None:
    msg = json_rpc_request(
        HelpBackendRequest.ShowHelpTopic, {"topic": "logging"}, comm_id="dummy_comm_id"
    )
    help_comm.handle_msg(msg)

    assert help_comm.messages == [
        json_rpc_response(result=True),
        show_help_event(f"{mock_pydoc_thread.url}get?key=logging"),
    ]
