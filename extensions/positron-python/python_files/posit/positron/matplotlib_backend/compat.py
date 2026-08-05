#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
Shims for the matplotlib and IPython versions that predate backend-registry support.

Keep this module free of matplotlib imports; see the package docstring.
"""

from __future__ import annotations


def get_backend_registry():
    """The matplotlib backend registry, or None if matplotlib < 3.9."""
    try:
        from matplotlib.backends.registry import backend_registry

        return backend_registry
    except ImportError:
        # No backend registry before matplotlib 3.9.
        return None


def register_with_legacy_ipython() -> None:
    """
    Make Positron's short names visible to IPython versions without registry support.

    IPython 8.24 started resolving `%matplotlib <name>` and building `%matplotlib -l`
    from matplotlib's backend registry (matplotlib >= 3.9), which discovers Positron's
    backends through their entry points. Earlier IPython reads the static
    `pylabtools.backends` table for both, so add the short names there. Uses the
    `module://` spelling as the value so the entries resolve on any matplotlib version.
    """
    from IPython.core import pylabtools as pt

    # Imported here rather than at module scope: `backend.py` imports this module for
    # `get_backend_registry`, so a module-level import would be circular.
    from .backend import Backend

    # The registry-based lister arrived in the same release that stopped reading the
    # static table, so its presence tells the two resolution schemes apart. Touching
    # `pt.backends` on newer IPython would also trip its deprecation warning.
    if hasattr(pt, "_list_matplotlib_backends_and_gui_loops"):
        return
    for backend in Backend:
        pt.backends.setdefault(backend.short_name, backend.full_name)
