#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
"""
Positron's matplotlib backends.

Positron ships one backend per session mode, each registered under its own short name
(`positron-console`, `positron-notebook`) via the `matplotlib.backend` entry point in
`python_files/posit/positron_matplotlib-<version>.dist-info`. `backend.py` holds the
names they share, `registry.py` the switch-time lifecycle called by
`PositronShell.enable_matplotlib`, and `compat.py` the shims for matplotlib and IPython
versions without backend-registry support.

Keep `backend.py`, `compat.py` and `registry.py` free of matplotlib imports, and this
module free of code entirely. The kernel imports them, and must work in environments
without matplotlib installed; `console.py`, `notebook.py` and `formats.py` are imported
lazily, and only once they're actually needed.
"""
