#
# Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import traitlets
from IPython.core.formatters import DisplayFormatter, IPythonDisplayFormatter, catch_format_error


class PositronDisplayFormatter(DisplayFormatter):
    @traitlets.default("ipython_display_formatter")
    def _default_formatter(self):
        return PositronIPythonDisplayFormatter(parent=self)


class PositronIPythonDisplayFormatter(IPythonDisplayFormatter):
    print_method = traitlets.ObjectName("_ipython_display_")
    _return_type = (type(None), bool)

    @catch_format_error
    def __call__(self, obj):
        """Compute the format for an object."""
        try:
            if obj.__module__ == "plotnine.ggplot":
                obj.draw(show=True)
                return True
        except AttributeError:
            pass
        return super().__call__(obj)
