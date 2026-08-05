#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
Tests for switching matplotlib backends with `%matplotlib` in a Positron session.

Exercises `PositronShell.enable_matplotlib`: bare `%matplotlib` and `%matplotlib inline`
keep the session's own Positron backend active, an explicit `positron-console` or
`positron-notebook` activates that backend outright (even across session modes), another
backend tears Positron's hooks down, and switching back restores them. `agg` is the
"other" backend throughout so the tests run headless. `Backend`'s name resolution behind
all of this is covered by `test_backend.py`.
"""

from __future__ import annotations

import contextlib
import sys
from functools import partial
from typing import TYPE_CHECKING, Callable, Iterator, NamedTuple

import matplotlib
import matplotlib.pyplot as plt
import pytest
from IPython.core import pylabtools
from IPython.utils.capture import capture_output
from matplotlib.figure import Figure

from positron.matplotlib_backend import compat, console, formats, notebook
from positron.matplotlib_backend.backend import Backend
from positron.matplotlib_backend.registry import (
    configure_matplotlib_support,
    install_backend_switch_hook,
    registry,
)
from positron.session_mode import SessionMode

from ..utils import run_with_metadata
from .conftest import active_backend

if TYPE_CHECKING:
    from types import ModuleType

    from positron.positron_ipkernel import PositronShell

INLINE_MODULE_NAME = "matplotlib_inline.backend_inline"
INLINE_BACKEND_NAME = f"module://{INLINE_MODULE_NAME}"

# The backend to switch away to. Headless, so these tests don't need a display.
OTHER_BACKEND_NAME = "agg"

# Whether `%matplotlib <name>` resolves through matplotlib's backend registry, which
# needs IPython >= 8.24 *and* matplotlib >= 3.9 -- IPython 8.24 kept the static-table
# fallback for older matplotlib. This private helper encodes both halves.
REGISTRY_BACKEND_RESOLUTION = getattr(pylabtools, "_matplotlib_manages_backends", lambda: False)()


class BackendCase(NamedTuple):
    """One of Positron's matplotlib backends, and how to detect that it's installed."""

    session_mode: SessionMode
    module: ModuleType
    backend: Backend
    # Whether the backend's non-hook integration is installed: the console backend's
    # `plt.gca` redirect, or the notebook backend's figure formatter.
    integration_installed: Callable[[PositronShell], bool]


def _console_integration_installed(shell: PositronShell) -> bool:  # noqa: ARG001
    return plt.gca is console._installed_gca  # noqa: SLF001


def _notebook_integration_installed(shell: PositronShell) -> bool:
    formatter = shell.display_formatter.formatters["image/png"]
    with contextlib.suppress(KeyError):
        # `lookup_by_type` raises KeyError when no formatter is registered for the type.
        # The registered callable is a `partial` binding `_display_figure` (see
        # `formats.select_figure_formats`), not the bare function, since it also binds
        # `format_` and any `print_figure_kwargs`.
        current = formatter.lookup_by_type(Figure)
        return isinstance(current, partial) and current.func is formats._display_figure  # noqa: SLF001
    return False


CONSOLE = BackendCase(
    SessionMode.CONSOLE,
    console,
    Backend.CONSOLE,
    _console_integration_installed,
)
NOTEBOOK = BackendCase(
    SessionMode.NOTEBOOK,
    notebook,
    Backend.NOTEBOOK,
    _notebook_integration_installed,
)


def _other_case(case: BackendCase) -> BackendCase:
    """The Positron backend that isn't `case`."""
    return NOTEBOOK if case is CONSOLE else CONSOLE


@pytest.fixture(params=[pytest.param(CONSOLE, id="console"), pytest.param(NOTEBOOK, id="notebook")])
def backend_case(request: pytest.FixtureRequest) -> BackendCase:
    """Each of Positron's matplotlib backends, one per session mode."""
    return request.param


@pytest.fixture
def positron_backend(
    backend_case: BackendCase, shell: PositronShell, monkeypatch: pytest.MonkeyPatch
) -> Iterator[BackendCase]:
    """A session with the parametrized Positron backend active."""
    yield from _session_with_backend(backend_case, shell, monkeypatch)


@pytest.fixture
def notebook_backend(
    shell: PositronShell, monkeypatch: pytest.MonkeyPatch
) -> Iterator[BackendCase]:
    """A notebook session with Positron's notebook backend active."""
    yield from _session_with_backend(NOTEBOOK, shell, monkeypatch)


@pytest.fixture
def console_backend(shell: PositronShell, monkeypatch: pytest.MonkeyPatch) -> Iterator[BackendCase]:
    """A console session with Positron's console backend active."""
    yield from _session_with_backend(CONSOLE, shell, monkeypatch)


def _session_with_backend(
    case: BackendCase, shell: PositronShell, monkeypatch: pytest.MonkeyPatch
) -> Iterator[BackendCase]:
    """
    Fixture body: a session with `case`'s backend active, as it is at kernel startup.

    Restores matplotlib's backend, both backends' hooks and any matplotlib-inline state
    afterwards, since matplotlib and the shell are process-wide singletons.
    """
    monkeypatch.setattr(shell, "session_mode", case.session_mode)

    # Entering a gui event loop needs a running kernel application, which tests don't have.
    monkeypatch.setattr(shell, "enable_gui", lambda gui=None: None)  # noqa: ARG005

    with active_backend(case.backend):
        yield case
        _reset_matplotlib_inline(shell)
        shell.kernel.plots_service.shutdown()
        plt.close("all")


def _reset_matplotlib_inline(shell: PositronShell) -> None:
    """Undo any matplotlib-inline state so it doesn't leak into the next test."""
    module = sys.modules.get(INLINE_MODULE_NAME)
    if module is None:
        return

    from matplotlib_inline.config import InlineBackend

    with contextlib.suppress(ValueError):
        shell.events.unregister("post_execute", module.flush_figures)

    saved_rc_params = shell.__dict__.pop("_saved_rcParams", None)
    if saved_rc_params is not None:
        matplotlib.rcParams.update(saved_rc_params)

    # `select_figure_formats` may have registered matplotlib-inline's figure formatters.
    for formatter in shell.display_formatter.formatters.values():
        formatter.pop(Figure, None)

    shell.configurables[:] = [c for c in shell.configurables if not isinstance(c, InlineBackend)]
    InlineBackend.clear_instance()

    # matplotlib-inline remembers the backend it last configured; forget it so the next
    # test starts from the same state.
    if hasattr(module.configure_inline_support, "current_backend"):
        del module.configure_inline_support.current_backend


def _hook_count(shell: PositronShell, module_name: str) -> int:
    """How many of `module_name`'s post execute hooks are registered on the shell."""
    return sum(
        1
        for callback in shell.events.callbacks["post_execute"]
        if callback.__module__ == module_name
    )


def _state(shell: PositronShell, case: BackendCase) -> dict:
    """A snapshot of the backend state that a `%matplotlib` switch should manage."""
    return {
        "backend": matplotlib.get_backend(),
        "positron_hooks": _hook_count(shell, case.module.__name__),
        "positron_integration": case.integration_installed(shell),
        "inline_hooks": _hook_count(shell, INLINE_MODULE_NAME),
    }


def _positron_active(case: BackendCase) -> dict:
    """The backend state after activating `case`'s Positron backend, inline uninvolved."""
    return {
        "backend": case.backend.short_name,
        "positron_hooks": 1,
        "positron_integration": True,
        "inline_hooks": 0,
    }


def test_inline_keeps_positron_backend(shell: PositronShell, positron_backend: BackendCase):
    """`%matplotlib inline`, the boilerplate first cell of countless notebooks, is ours."""
    shell.run_cell("%matplotlib inline").raise_error()

    assert _state(shell, positron_backend) == _positron_active(positron_backend)


def test_inline_is_idempotent(shell: PositronShell, positron_backend: BackendCase):
    """Repeated `%matplotlib inline` registers the post execute hook exactly once."""
    shell.run_cell("%matplotlib inline").raise_error()
    shell.run_cell("%matplotlib inline").raise_error()

    assert _state(shell, positron_backend) == _positron_active(positron_backend)


def test_inline_still_creates_positron_figures(shell: PositronShell, positron_backend: BackendCase):
    """Figures created after `%matplotlib inline` still go through Positron's backend."""
    shell.run_cell("%matplotlib inline").raise_error()
    # Record the canvas type in the cell that creates the figure: the notebook backend
    # closes figures after each cell, which drops the canvas.
    shell.run_cell(
        "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\ncanvas_type = type(fig.canvas)"
    ).raise_error()

    assert shell.user_ns["canvas_type"] is positron_backend.module.FigureCanvas


def test_inline_keeps_figure_sizing(shell: PositronShell, notebook_backend: BackendCase):  # noqa: ARG001
    """`#| fig-width` and `#| fig-height` still size figures after `%matplotlib inline`."""
    shell.run_cell("%matplotlib inline").raise_error()
    run_with_metadata(
        "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()",
        {"fig-width": 8, "fig-height": 4},
    )

    assert shell.user_ns["fig"].get_size_inches().tolist() == [8.0, 4.0]


def test_bare_magic_selects_positron(shell: PositronShell, positron_backend: BackendCase):
    """Bare `%matplotlib` selects Positron's backend, and prints a name users can reuse."""
    with capture_output() as captured:
        shell.run_cell("%matplotlib").raise_error()

    expected = f"Using matplotlib backend: {positron_backend.backend.short_name}"

    assert captured.stdout.strip() == expected
    assert _state(shell, positron_backend) == _positron_active(positron_backend)


def test_explicit_short_name_selects_own_backend(
    shell: PositronShell, positron_backend: BackendCase
):
    """`%matplotlib <the session's own short name>` selects that backend."""
    shell.run_cell(f"%matplotlib {positron_backend.backend.short_name}").raise_error()

    assert _state(shell, positron_backend) == _positron_active(positron_backend)


def test_explicit_short_name_selects_other_backend_across_modes(
    shell: PositronShell, positron_backend: BackendCase
):
    """
    `%matplotlib <the other backend's short name>` activates that backend outright.

    Cross-mode selection is intentional now that each backend has its own short name:
    unlike the session-relative `positron` name it replaces, an explicit short name
    always wins over the session's own mode.
    """
    other = _other_case(positron_backend)

    shell.run_cell(f"%matplotlib {other.backend.short_name}").raise_error()

    assert _state(shell, other) == _positron_active(other)
    # The backend that was active coming in has been torn down.
    assert _state(shell, positron_backend) == {
        "backend": other.backend.short_name,
        "positron_hooks": 0,
        "positron_integration": False,
        "inline_hooks": 0,
    }


def test_console_backend_in_notebook_session_routes_to_plots_pane(
    shell: PositronShell,
    notebook_backend: BackendCase,  # noqa: ARG001
):
    """
    In a notebook session, `%matplotlib positron-console` routes figures to the Plots pane.

    The cross-mode switch is a feature: a notebook (or Quarto inline output) session can
    opt its figures out of inline display and into the Plots pane's comm-based rendering.
    """
    shell.run_cell(f"%matplotlib {Backend.CONSOLE.short_name}").raise_error()

    with capture_output() as captured:
        shell.run_cell("import matplotlib.pyplot as plt\nfig, ax = plt.subplots()").raise_error()

    # The figure opened a plot comm (the Plots pane) instead of displaying inline.
    assert len(shell.kernel.plots_service._plots) == 1  # noqa: SLF001
    assert not captured.outputs


def test_notebook_backend_in_console_session_displays_inline(
    shell: PositronShell,
    console_backend: BackendCase,  # noqa: ARG001
):
    """In a console session, `%matplotlib positron-notebook` displays figures inline."""
    shell.run_cell(f"%matplotlib {Backend.NOTEBOOK.short_name}").raise_error()

    with capture_output() as captured:
        shell.run_cell(
            "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nax.plot([0, 1], [0, 1])"
        ).raise_error()

    # The figure displayed inline (as a PNG) instead of opening a plot comm.
    assert not shell.kernel.plots_service._plots  # noqa: SLF001
    assert len(captured.outputs) == 1
    assert captured.outputs[0]._repr_png_() is not None


def test_positron_short_names_are_listed_backends(shell: PositronShell):
    """Both of Positron's backends are first-class names, so they show up in `%matplotlib -l`."""
    with capture_output() as captured:
        shell.run_cell("%matplotlib -l").raise_error()

    assert Backend.CONSOLE.short_name in captured.stdout
    assert Backend.NOTEBOOK.short_name in captured.stdout


def test_explicit_short_name_without_registry_resolution(
    shell: PositronShell, positron_backend: BackendCase, monkeypatch: pytest.MonkeyPatch
):
    """
    Explicit short names select the backend even when IPython can't resolve them.

    IPython < 8.24 resolves `%matplotlib <name>` through a static table that raises
    KeyError for entry-point backends like Positron's, instead of matplotlib's backend
    registry. Simulate that here: the switch must not reach `find_gui_and_backend`.
    """
    from IPython.core import pylabtools as pt

    def legacy_find_gui_and_backend(gui=None, gui_select=None):  # noqa: ARG001
        raise KeyError(gui)

    monkeypatch.setattr(pt, "find_gui_and_backend", legacy_find_gui_and_backend)

    shell.run_cell(f"%matplotlib {positron_backend.backend.short_name}").raise_error()

    assert _state(shell, positron_backend) == _positron_active(positron_backend)


def test_register_with_legacy_ipython_adds_short_names(monkeypatch: pytest.MonkeyPatch):
    """On IPython < 8.24, the short names are added to the static backend table for `-l`."""
    from IPython.core import pylabtools as pt

    # Simulate IPython < 8.24: no registry-based lister, `-l` reads `pt.backends`.
    if hasattr(pt, "_list_matplotlib_backends_and_gui_loops"):
        monkeypatch.delattr(pt, "_list_matplotlib_backends_and_gui_loops")
    legacy_table = {"inline": INLINE_BACKEND_NAME}
    monkeypatch.setattr(pt, "backends", legacy_table)

    compat.register_with_legacy_ipython()

    assert legacy_table == {
        "inline": INLINE_BACKEND_NAME,
        Backend.CONSOLE.short_name: Backend.CONSOLE.full_name,
        Backend.NOTEBOOK.short_name: Backend.NOTEBOOK.full_name,
    }


def test_legacy_ipython_lists_short_names_without_a_switch(
    shell: PositronShell, monkeypatch: pytest.MonkeyPatch
):
    """
    On IPython < 8.24, `%matplotlib -l` lists Positron's backends before any switch.

    Legacy `%matplotlib -l` prints `list(pylabtools.backends)` from inside the magic
    (verified in IPython 8.23's `core/magics/pylab.py`), so it never reaches
    `enable_matplotlib`. Registering the short names on the switch path instead of at
    shell init would therefore leave them out of `-l` until the user had already
    switched backends, which is why `PositronShell.init_magics` is the registration site.

    The magic's own `-l` branch can't be driven here, since the installed IPython lists
    from matplotlib's registry rather than the static table; this asserts on the table
    that legacy `-l` reads.
    """
    from IPython.core import pylabtools as pt

    # Simulate IPython < 8.24: no registry-based lister, `-l` reads `pt.backends`.
    if hasattr(pt, "_list_matplotlib_backends_and_gui_loops"):
        monkeypatch.delattr(pt, "_list_matplotlib_backends_and_gui_loops")
    monkeypatch.setattr(pt, "backends", {"inline": INLINE_BACKEND_NAME})

    # The shell was constructed before the simulation was in place, so re-run the hook
    # that registers the names. Notably not `enable_matplotlib`: nothing here switches
    # backends, because `-l` has to list them without one.
    shell.init_magics()

    assert set(pt.backends) == {
        "inline",
        Backend.CONSOLE.short_name,
        Backend.NOTEBOOK.short_name,
    }


def test_other_backend_deactivates(shell: PositronShell, positron_backend: BackendCase):
    """Switching to another backend removes Positron's hooks instead of leaving them."""
    shell.run_cell(f"%matplotlib {OTHER_BACKEND_NAME}").raise_error()

    assert _state(shell, positron_backend) == {
        "backend": OTHER_BACKEND_NAME,
        "positron_hooks": 0,
        "positron_integration": False,
        "inline_hooks": 0,
    }


def test_switching_back_reactivates(shell: PositronShell, positron_backend: BackendCase):
    """`%matplotlib inline` after another backend switches back instead of staying stuck."""
    shell.run_cell(f"%matplotlib {OTHER_BACKEND_NAME}").raise_error()
    shell.run_cell("%matplotlib inline").raise_error()

    assert _state(shell, positron_backend) == _positron_active(positron_backend)


def test_deactivate_twice_is_noop(shell: PositronShell, positron_backend: BackendCase):
    """A second teardown for a non-Positron backend is a no-op, not an error."""
    registry.activate(OTHER_BACKEND_NAME)
    registry.activate(OTHER_BACKEND_NAME)

    assert _state(shell, positron_backend) == {
        "backend": positron_backend.backend.full_name,
        "positron_hooks": 0,
        "positron_integration": False,
        "inline_hooks": 0,
    }


def test_inline_backend_config_stays_inert(shell: PositronShell, positron_backend: BackendCase):
    """
    `%config InlineBackend.*` stays a no-op across switches that never target inline.

    Positron's backend never instantiates `InlineBackend` into `shell.configurables`, so
    the traitlets observer that would re-run `select_figure_formats` -- popping Positron's
    figure formatter -- is never armed.
    """
    shell.run_cell("%matplotlib inline").raise_error()
    shell.run_cell(f"%matplotlib {OTHER_BACKEND_NAME}").raise_error()
    shell.run_cell("%matplotlib").raise_error()

    assert not [c for c in shell.configurables if type(c).__name__ == "InlineBackend"]

    shell.run_cell("%config InlineBackend.figure_format = 'svg'").raise_error()

    assert _state(shell, positron_backend) == _positron_active(positron_backend)


@pytest.mark.skipif(
    not REGISTRY_BACKEND_RESOLUTION,
    reason="`%matplotlib module://...` needs registry-based backend resolution",
)
def test_matplotlib_inline_escape_hatch(shell: PositronShell, positron_backend: BackendCase):
    """
    The real matplotlib-inline backend stays reachable by its `module://` name.

    Only via `%matplotlib` where backends resolve through matplotlib's registry: without
    it, IPython resolves the magic's argument through a static table that has `inline`
    but not the `module://` spelling, so the switch raises KeyError before reaching
    Positron -- upstream behavior for any `module://` name, not something the override
    introduces. `matplotlib.use(INLINE_BACKEND_NAME)` is the escape hatch there instead,
    on every version: the backend module self-activates at import, flowing through
    Positron's `configure_inline_support` seam.

    Skipped rather than shimmed on the table-based versions (IPython < 8.24 or
    matplotlib < 3.9, both 2+ years old; all of Python 3.9, EOL October 2025, is capped
    at IPython 8.18): `matplotlib.use` fully covers the escape, the KeyError matches
    stock IPython, and the affected stacks only shrink. If a user on one of them ever
    needs the magic spelling, `PositronShell.enable_matplotlib` already switches
    Positron's own names by hand on exactly these versions, and that recipe extends to
    `module://` names in a few lines.
    """
    shell.run_cell(f"%matplotlib {INLINE_BACKEND_NAME}").raise_error()
    inline_state = _state(shell, positron_backend)

    shell.run_cell("%matplotlib inline").raise_error()

    assert inline_state == {
        "backend": INLINE_BACKEND_NAME,
        "positron_hooks": 0,
        "positron_integration": False,
        "inline_hooks": 1,
    }
    assert _state(shell, positron_backend) == _positron_active(positron_backend)


def test_set_matplotlib_formats_patch_installed_while_active(positron_backend: BackendCase):  # noqa: ARG001
    """The shared `set_matplotlib_formats` patch is installed while a Positron backend is active."""
    import matplotlib_inline.backend_inline as backend_inline

    assert backend_inline.set_matplotlib_formats is formats._installed_set_matplotlib_formats  # noqa: SLF001


def test_set_matplotlib_formats_patch_restored_after_switch(
    shell: PositronShell,
    positron_backend: BackendCase,  # noqa: ARG001
):
    """Switching to a non-Positron backend restores the original `set_matplotlib_formats`."""
    import matplotlib_inline.backend_inline as backend_inline

    original = formats._original_set_matplotlib_formats  # noqa: SLF001

    shell.run_cell(f"%matplotlib {OTHER_BACKEND_NAME}").raise_error()

    assert backend_inline.set_matplotlib_formats is original


def test_notebook_to_console_switch_keeps_patch_installed(
    shell: PositronShell,
    notebook_backend: BackendCase,  # noqa: ARG001
):
    """
    A notebook -> console switch keeps the same `set_matplotlib_formats` patch installed.

    The patch's lifecycle is owned by `PositronBackendRegistry` ("a Positron backend is
    active"), not by the individual backends, so a cross-backend switch -- which never
    lets the active backend become `None` in between -- leaves the same patch object in
    place instead of tearing it down and reinstalling a fresh one.
    """
    import matplotlib_inline.backend_inline as backend_inline

    installed_before = backend_inline.set_matplotlib_formats

    shell.run_cell(f"%matplotlib {Backend.CONSOLE.short_name}").raise_error()

    assert backend_inline.set_matplotlib_formats is installed_before
    assert backend_inline.set_matplotlib_formats is formats._installed_set_matplotlib_formats  # noqa: SLF001


def test_install_backend_switch_hook_is_idempotent():
    """Calling `install_backend_switch_hook` twice doesn't double-wrap `configure_inline_support`."""
    import matplotlib_inline.backend_inline as backend_inline

    install_backend_switch_hook()
    install_backend_switch_hook()

    assert backend_inline.configure_inline_support is configure_matplotlib_support
    assert (
        registry._original_configure_inline_support  # noqa: SLF001
        is not configure_matplotlib_support
    )
