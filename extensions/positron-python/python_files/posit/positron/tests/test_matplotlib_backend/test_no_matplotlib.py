#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
Test that the kernel still imports in an environment without matplotlib.

The kernel imports `matplotlib_backend.backend` and `.compat` unconditionally, so those
modules -- and `.registry`, which they must not drag matplotlib in through either -- have
to stay matplotlib-free; `console.py`, `notebook.py` and `formats.py` may only be
imported lazily. That invariant is documented in each module, but a stray convenience
import would break every matplotlib-less session silently, so pin it down here.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import positron

# The kernel's import root, so the subprocess resolves `positron` from this checkout.
_IMPORT_ROOT = Path(positron.__file__).parent.parent

# Run in a subprocess: this test process has matplotlib loaded already, and a meta path
# finder can only block a module that isn't in `sys.modules` yet.
_SCRIPT = """
import sys


class BlockMatplotlib:
    "Meta path finder that makes matplotlib and friends look uninstalled."

    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".")[0] in {"matplotlib", "matplotlib_inline", "mpl_toolkits"}:
            raise ImportError(fullname)
        return None


sys.meta_path.insert(0, BlockMatplotlib())

# Whatever the kernel imports at startup, plus the one module it defers to first use, so
# breaking the invariant in any of the three fails here rather than only in the field.
import positron.matplotlib_backend.registry  # noqa: F401
import positron.positron_ipkernel  # noqa: F401

# Guard against a vacuous pass: the kernel really did import the package, and none of
# these imports pulled matplotlib in.
assert "positron.matplotlib_backend.backend" in sys.modules
assert "positron.matplotlib_backend.compat" in sys.modules
assert "matplotlib" not in sys.modules
"""


def test_kernel_imports_without_matplotlib():
    """Importing the kernel with matplotlib blocked succeeds and doesn't import matplotlib."""
    result = subprocess.run(
        [sys.executable, "-c", _SCRIPT],
        cwd=_IMPORT_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
