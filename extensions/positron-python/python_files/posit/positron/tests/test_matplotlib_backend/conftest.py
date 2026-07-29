#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import contextlib
from typing import TYPE_CHECKING

import matplotlib

from positron.matplotlib_backend import Backend, configure_positron_support

if TYPE_CHECKING:
    from typing import Iterator


@contextlib.contextmanager
def active_backend(backend: Backend) -> Iterator[None]:
    """Activate a Positron matplotlib backend, restoring the previous backend on exit."""
    prev = matplotlib.get_backend()
    matplotlib.use(backend.full_name)
    configure_positron_support(backend)
    try:
        yield
    finally:
        configure_positron_support(prev)
        matplotlib.use(prev)
