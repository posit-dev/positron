#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""Patch modules for external libraries compatibility with Positron."""

from .bokeh import handle_bokeh_output, patch_bokeh_no_access
from .haystack import patch_haystack_is_in_jupyter
from .holoviews import set_holoviews_extension

__all__ = [
    "handle_bokeh_output",
    "patch_bokeh_no_access",
    "patch_haystack_is_in_jupyter",
    "set_holoviews_extension",
]
