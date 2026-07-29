#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
Tests for switching matplotlib backends with `%matplotlib` in a Positron session.

Exercises `PositronShell.enable_matplotlib`: bare `%matplotlib` and `%matplotlib inline`
keep the session's own Positron backend active, an explicit `positron-console` or
`positron-notebook` activates that flavor outright (even across session modes), another
backend tears Positron's hooks down, and switching back restores them. `agg` is the
"other" backend throughout so the tests run headless. Also covers `Backend`'s
name-resolution helper (`from_name`) behind all of this.
"""

from __future__ import annotations

import contextlib
import sys
from functools import partial
from typing import TYPE_CHECKING, Callable, Iterator, NamedTuple

import matplotlib
import matplotlib.pyplot as plt
import pytest
from IPython.utils.capture import capture_output
from matplotlib.figure import Figure

from positron import matplotlib_backend
from positron.matplotlib_backend import (
    Backend,
    console,
    formats,
    notebook,
)
from positron.session_mode import SessionMode

from ..utils import run_with_metadata

if TYPE_CHECKING:
    from types import ModuleType

    from positron.positron_ipkernel import PositronShell

INLINE_MODULE_NAME = "matplotlib_inline.backend_inline"
INLINE_BACKEND_NAME = f"module://{INLINE_MODULE_NAME}"

# The backend to switch away to. Headless, so these tests don't need a display.
OTHER_BACKEND_NAME = "agg"


class Flavor(NamedTuple):
    """One of Positron's matplotlib backends, and how to detect that it's installed."""

    session_mode: SessionMode
    module: ModuleType
    backend: Backend
    # Whether the flavor's non-hook integration is installed: the console backend's
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


CONSOLE = Flavor(
    SessionMode.CONSOLE,
    console,
    Backend.CONSOLE,
    _console_integration_installed,
)
NOTEBOOK = Flavor(
    SessionMode.NOTEBOOK,
    notebook,
    Backend.NOTEBOOK,
    _notebook_integration_installed,
)


def _other_flavor(flavor: Flavor) -> Flavor:
    """The flavor that isn't `flavor`."""
    return NOTEBOOK if flavor is CONSOLE else CONSOLE


@pytest.fixture(params=[pytest.param(CONSOLE, id="console"), pytest.param(NOTEBOOK, id="notebook")])
def flavor(request: pytest.FixtureRequest) -> Flavor:
    """Each of Positron's matplotlib backends, one per session mode."""
    return request.param


@pytest.fixture
def positron_backend(
    flavor: Flavor, shell: PositronShell, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Flavor]:
    """A session with the parametrized flavor's Positron backend active."""
    yield from _session_with_backend(flavor, shell, monkeypatch)


@pytest.fixture
def notebook_backend(shell: PositronShell, monkeypatch: pytest.MonkeyPatch) -> Iterator[Flavor]:
    """A notebook session with Positron's notebook backend active."""
    yield from _session_with_backend(NOTEBOOK, shell, monkeypatch)


@pytest.fixture
def console_backend(shell: PositronShell, monkeypatch: pytest.MonkeyPatch) -> Iterator[Flavor]:
    """A console session with Positron's console backend active."""
    yield from _session_with_backend(CONSOLE, shell, monkeypatch)


def _session_with_backend(
    flavor: Flavor, shell: PositronShell, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Flavor]:
    """
    Fixture body: a session with `flavor`'s backend active, as it is at kernel startup.

    Restores matplotlib's backend, both flavors' hooks and any matplotlib-inline state
    afterwards, since matplotlib and the shell are process-wide singletons.
    """
    monkeypatch.setattr(shell, "session_mode", flavor.session_mode)

    # Entering a gui event loop needs a running kernel application, which tests don't have.
    monkeypatch.setattr(shell, "enable_gui", lambda gui=None: None)  # noqa: ARG005

    previous_backend = matplotlib.get_backend()
    matplotlib.use(flavor.backend.full_name)
    matplotlib_backend.configure_positron_support(flavor.backend)

    yield flavor

    matplotlib_backend.configure_positron_support(previous_backend)
    _reset_matplotlib_inline(shell)
    shell.kernel.plots_service.shutdown()
    plt.close("all")
    matplotlib.use(previous_backend)


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


def _state(shell: PositronShell, flavor: Flavor) -> dict:
    """A snapshot of the backend state that a `%matplotlib` switch should manage."""
    return {
        "backend": matplotlib.get_backend(),
        "positron_hooks": _hook_count(shell, flavor.module.__name__),
        "positron_integration": flavor.integration_installed(shell),
        "inline_hooks": _hook_count(shell, INLINE_MODULE_NAME),
    }


def _positron_active(flavor: Flavor) -> dict:
    """The backend state after activating `flavor`'s Positron backend, inline uninvolved."""
    return {
        "backend": flavor.backend.short_name,
        "positron_hooks": 1,
        "positron_integration": True,
        "inline_hooks": 0,
    }


def test_inline_keeps_positron_backend(shell: PositronShell, positron_backend: Flavor):
    """`%matplotlib inline`, the boilerplate first cell of countless notebooks, is ours."""
    shell.run_cell("%matplotlib inline").raise_error()

    assert _state(shell, positron_backend) == _positron_active(positron_backend)


def test_inline_is_idempotent(shell: PositronShell, positron_backend: Flavor):
    """Repeated `%matplotlib inline` registers the post execute hook exactly once."""
    shell.run_cell("%matplotlib inline").raise_error()
    shell.run_cell("%matplotlib inline").raise_error()

    assert _state(shell, positron_backend) == _positron_active(positron_backend)


def test_inline_still_creates_positron_figures(shell: PositronShell, positron_backend: Flavor):
    """Figures created after `%matplotlib inline` still go through Positron's backend."""
    shell.run_cell("%matplotlib inline").raise_error()
    # Record the canvas type in the cell that creates the figure: the notebook backend
    # closes figures after each cell, which drops the canvas.
    shell.run_cell(
        "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\ncanvas_type = type(fig.canvas)"
    ).raise_error()

    assert shell.user_ns["canvas_type"] is positron_backend.module.FigureCanvas


def test_inline_keeps_figure_sizing(shell: PositronShell, notebook_backend: Flavor):  # noqa: ARG001
    """`#| fig-width` and `#| fig-height` still size figures after `%matplotlib inline`."""
    shell.run_cell("%matplotlib inline").raise_error()
    run_with_metadata(
        "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()",
        {"fig-width": 8, "fig-height": 4},
    )

    assert shell.user_ns["fig"].get_size_inches().tolist() == [8.0, 4.0]


def test_bare_magic_selects_positron(shell: PositronShell, positron_backend: Flavor):
    """Bare `%matplotlib` selects Positron's backend, and prints a name users can reuse."""
    with capture_output() as captured:
        shell.run_cell("%matplotlib").raise_error()

    expected = f"Using matplotlib backend: {positron_backend.backend.short_name}"

    assert captured.stdout.strip() == expected
    assert _state(shell, positron_backend) == _positron_active(positron_backend)


def test_explicit_short_name_selects_own_flavor(shell: PositronShell, positron_backend: Flavor):
    """`%matplotlib <flavor's own short name>` selects that flavor."""
    shell.run_cell(f"%matplotlib {positron_backend.backend.short_name}").raise_error()

    assert _state(shell, positron_backend) == _positron_active(positron_backend)


def test_explicit_short_name_selects_other_flavor_across_modes(
    shell: PositronShell, positron_backend: Flavor
):
    """
    `%matplotlib <other flavor's short name>` activates that flavor outright.

    Cross-mode selection is intentional now that each flavor has its own short name:
    unlike the session-relative `positron` name it replaces, an explicit short name
    always wins over the session's own mode.
    """
    other = _other_flavor(positron_backend)

    shell.run_cell(f"%matplotlib {other.backend.short_name}").raise_error()

    assert _state(shell, other) == _positron_active(other)
    # The flavor that was active coming in has been torn down.
    assert _state(shell, positron_backend) == {
        "backend": other.backend.short_name,
        "positron_hooks": 0,
        "positron_integration": False,
        "inline_hooks": 0,
    }


def test_console_flavor_in_notebook_session_routes_to_plots_pane(
    shell: PositronShell,
    notebook_backend: Flavor,  # noqa: ARG001
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


def test_notebook_flavor_in_console_session_displays_inline(
    shell: PositronShell,
    console_backend: Flavor,  # noqa: ARG001
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
    shell: PositronShell, positron_backend: Flavor, monkeypatch: pytest.MonkeyPatch
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

    matplotlib_backend.register_with_legacy_ipython()

    assert legacy_table == {
        "inline": INLINE_BACKEND_NAME,
        Backend.CONSOLE.short_name: Backend.CONSOLE.full_name,
        Backend.NOTEBOOK.short_name: Backend.NOTEBOOK.full_name,
    }


def test_other_backend_deactivates(shell: PositronShell, positron_backend: Flavor):
    """Switching to another backend removes Positron's hooks instead of leaving them."""
    shell.run_cell(f"%matplotlib {OTHER_BACKEND_NAME}").raise_error()

    assert _state(shell, positron_backend) == {
        "backend": OTHER_BACKEND_NAME,
        "positron_hooks": 0,
        "positron_integration": False,
        "inline_hooks": 0,
    }


def test_switching_back_reactivates(shell: PositronShell, positron_backend: Flavor):
    """`%matplotlib inline` after another backend switches back instead of staying stuck."""
    shell.run_cell(f"%matplotlib {OTHER_BACKEND_NAME}").raise_error()
    shell.run_cell("%matplotlib inline").raise_error()

    assert _state(shell, positron_backend) == _positron_active(positron_backend)


def test_deactivate_twice_is_noop(shell: PositronShell, positron_backend: Flavor):
    """A second teardown for a non-Positron backend is a no-op, not an error."""
    matplotlib_backend.configure_positron_support(OTHER_BACKEND_NAME)
    matplotlib_backend.configure_positron_support(OTHER_BACKEND_NAME)

    assert _state(shell, positron_backend) == {
        "backend": positron_backend.backend.full_name,
        "positron_hooks": 0,
        "positron_integration": False,
        "inline_hooks": 0,
    }


def test_inline_backend_config_stays_inert(shell: PositronShell, positron_backend: Flavor):
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


def test_matplotlib_inline_escape_hatch(shell: PositronShell, positron_backend: Flavor):
    """The real matplotlib-inline backend stays reachable by its `module://` name."""
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


def test_set_matplotlib_formats_patch_installed_while_active(positron_backend: Flavor):  # noqa: ARG001
    """The shared `set_matplotlib_formats` patch is installed while a Positron flavor is active."""
    import matplotlib_inline.backend_inline as backend_inline

    assert backend_inline.set_matplotlib_formats is formats._installed_set_matplotlib_formats  # noqa: SLF001


def test_set_matplotlib_formats_patch_restored_after_switch(
    shell: PositronShell,
    positron_backend: Flavor,  # noqa: ARG001
):
    """Switching to a non-Positron backend restores the original `set_matplotlib_formats`."""
    import matplotlib_inline.backend_inline as backend_inline

    original = formats._original_set_matplotlib_formats  # noqa: SLF001

    shell.run_cell(f"%matplotlib {OTHER_BACKEND_NAME}").raise_error()

    assert backend_inline.set_matplotlib_formats is original


def test_notebook_to_console_switch_keeps_patch_installed(
    shell: PositronShell,
    notebook_backend: Flavor,  # noqa: ARG001
):
    """
    A notebook -> console switch keeps the same `set_matplotlib_formats` patch installed.

    The patch's lifecycle is owned by `configure_positron_support` ("a Positron backend
    is active"), not by the individual flavors, so a cross-flavor switch -- which never
    lets `_active_backend` become `None` in between -- leaves the same patch object in
    place instead of tearing it down and reinstalling a fresh one.
    """
    import matplotlib_inline.backend_inline as backend_inline

    installed_before = backend_inline.set_matplotlib_formats

    shell.run_cell(f"%matplotlib {Backend.CONSOLE.short_name}").raise_error()

    assert backend_inline.set_matplotlib_formats is installed_before
    assert backend_inline.set_matplotlib_formats is formats._installed_set_matplotlib_formats  # noqa: SLF001


def test_from_name_recognizes_own_names(flavor: Flavor):
    """`Backend.from_name` accepts a flavor's own short name and its `module://` name."""
    assert Backend.from_name(flavor.backend.short_name) is flavor.backend
    assert Backend.from_name(flavor.backend.full_name) is flavor.backend


def test_from_name_rejects_other_names(flavor: Flavor):
    """`Backend.from_name` doesn't resolve the other flavor's names to this flavor, or a foreign backend at all."""
    other = _other_flavor(flavor)

    assert Backend.from_name(other.backend.short_name) is not flavor.backend
    assert Backend.from_name(other.backend.full_name) is not flavor.backend
    assert Backend.from_name(OTHER_BACKEND_NAME) is None


def test_from_name_short_name_case_insensitive(flavor: Flavor):
    """Short names match case-insensitively, like matplotlib's backend registry."""
    assert Backend.from_name(flavor.backend.short_name.upper()) is flavor.backend


def test_from_name_full_name_case_sensitive(flavor: Flavor):
    """The path after `module://` is an importable module path, so case matters."""
    assert Backend.from_name(f"module://{flavor.module.__name__.upper()}") is None


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
def test_backend_for_session_mode(session_mode: SessionMode, expected: Backend):
    """Each session mode maps to the Positron backend that suits it."""
    assert Backend.for_session_mode(session_mode) is expected


def test_preferred_name_prefers_short_name(flavor: Flavor):
    """The flavor's short name is preferred when matplotlib's backend registry knows it."""
    assert flavor.backend.preferred_name == flavor.backend.short_name


def test_preferred_name_falls_back_to_module_name(flavor: Flavor, monkeypatch: pytest.MonkeyPatch):
    """Falls back to the `module://` name before matplotlib 3.9, which has no registry."""
    monkeypatch.setattr(matplotlib_backend, "_get_backend_registry", lambda: None)

    assert flavor.backend.preferred_name == flavor.backend.full_name


def test_install_backend_switch_hook_is_idempotent():
    """Calling `install_backend_switch_hook` twice doesn't double-wrap `configure_inline_support`."""
    import matplotlib_inline.backend_inline as backend_inline

    matplotlib_backend.install_backend_switch_hook()
    matplotlib_backend.install_backend_switch_hook()

    assert (
        backend_inline.configure_inline_support is matplotlib_backend.configure_matplotlib_support
    )
    assert (
        matplotlib_backend._original_configure_inline_support  # noqa: SLF001
        is not matplotlib_backend.configure_matplotlib_support
    )
