#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import contextlib
from typing import TYPE_CHECKING

import matplotlib

from positron.matplotlib_backend.registry import registry

if TYPE_CHECKING:
    from typing import Generator

    from positron.matplotlib_backend.backend import Backend


@contextlib.contextmanager
def active_backend(backend: Backend) -> Generator[None, None, None]:
    """Activate a Positron matplotlib backend, restoring the previous backend on exit."""
    prev = matplotlib.get_backend()
    matplotlib.use(backend.full_name)
    # matplotlib has no switch-callback API (`pyplot.switch_backend` notifies nothing), so
    # in production the backend module's import-time trailer is what activates Positron's
    # support. `matplotlib.use` here often finds the module already imported, so that
    # trailer doesn't re-run; activate manually to simulate it.
    registry.activate(backend)
    try:
        yield
    finally:
        registry.activate(prev)
        matplotlib.use(prev)
