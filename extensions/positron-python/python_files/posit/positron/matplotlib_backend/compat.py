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

    # `backends` is a real module global exactly on the versions that read it: 8.24
    # renamed it to `_deprecated_backends` behind a `__getattr__` shim when it moved to
    # the registry, and 9.16 removed the shim. Looking it up in the module's own
    # namespace therefore tells the two resolution schemes apart *and* confirms there's
    # a table to write to.
    legacy_table = vars(pt).get("backends")
    if legacy_table is None:
        return
    for backend in Backend:
        legacy_table.setdefault(backend.short_name, backend.full_name)
