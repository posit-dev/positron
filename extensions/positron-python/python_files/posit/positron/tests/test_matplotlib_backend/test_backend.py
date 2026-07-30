#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
Tests for `Backend`, the names of Positron's matplotlib backends.

Pure name resolution, no shell or matplotlib backend switching involved: which session
mode maps to which backend, which spellings `from_name` accepts, and which spelling
`preferred_name` hands to matplotlib.
"""

from __future__ import annotations

import pytest

from positron.matplotlib_backend import backend as backend_module
from positron.matplotlib_backend.backend import Backend
from positron.session_mode import SessionMode

# A backend that isn't ours. Headless, matching the rest of the suite.
OTHER_BACKEND_NAME = "agg"


@pytest.fixture(
    params=[
        pytest.param(Backend.CONSOLE, id="console"),
        pytest.param(Backend.NOTEBOOK, id="notebook"),
    ]
)
def backend(request: pytest.FixtureRequest) -> Backend:
    """Each of Positron's matplotlib backends."""
    return request.param


def _other_backend(backend: Backend) -> Backend:
    """The Positron backend that isn't `backend`."""
    return Backend.NOTEBOOK if backend is Backend.CONSOLE else Backend.CONSOLE


@pytest.mark.parametrize(
    ("session_mode", "expected"),
    [
        (SessionMode.CONSOLE, Backend.CONSOLE),
        (SessionMode.NOTEBOOK, Backend.NOTEBOOK),
        # BACKGROUND sessions have no notebook to render into, so they get the console
        # backend, which routes figures to the plots pane.
        (SessionMode.BACKGROUND, Backend.CONSOLE),
    ],
)
def test_for_session_mode(session_mode: SessionMode, expected: Backend):
    """Each session mode maps to the Positron backend that suits it."""
    assert Backend.for_session_mode(session_mode) is expected


def test_from_name_recognizes_own_names(backend: Backend):
    """`Backend.from_name` accepts a backend's own short name and its `module://` name."""
    assert Backend.from_name(backend.short_name) is backend
    assert Backend.from_name(backend.full_name) is backend


def test_from_name_rejects_other_names(backend: Backend):
    """`Backend.from_name` resolves neither the other backend's names nor a foreign backend to `backend`."""
    other = _other_backend(backend)

    assert Backend.from_name(other.short_name) is not backend
    assert Backend.from_name(other.full_name) is not backend
    assert Backend.from_name(OTHER_BACKEND_NAME) is None


def test_from_name_short_name_case_insensitive(backend: Backend):
    """Short names match case-insensitively, like matplotlib's backend registry."""
    assert Backend.from_name(backend.short_name.upper()) is backend


def test_from_name_full_name_case_sensitive(backend: Backend):
    """The path after `module://` is an importable module path, so case matters."""
    assert Backend.from_name(f"module://{backend.module_name.upper()}") is None


def test_preferred_name_prefers_short_name(backend: Backend):
    """The backend's short name is preferred when matplotlib's backend registry knows it."""
    assert backend.preferred_name == backend.short_name


def test_preferred_name_falls_back_to_module_name(
    backend: Backend, monkeypatch: pytest.MonkeyPatch
):
    """Falls back to the `module://` name before matplotlib 3.9, which has no registry."""
    # Patched on `backend.py`, which imported the shim by name, not on `compat.py`.
    monkeypatch.setattr(backend_module, "get_backend_registry", lambda: None)

    assert backend.preferred_name == backend.full_name
