#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import traitlets
from IPython.core.formatters import (
    BaseFormatter,
    DisplayFormatter,
    IPythonDisplayFormatter,
)

from .data_explorer_formatter import create_data_explorer_formatter

if TYPE_CHECKING:
    import plotnine

    from ..positron_ipkernel import PositronShell


logger = logging.getLogger(__name__)


class PositronDisplayFormatter(DisplayFormatter):
    parent: PositronShell

    @traitlets.default("ipython_display_formatter")
    def _default_formatter(self):
        formatter: IPythonDisplayFormatter = super()._default_formatter()

        # Override plotnine ggplot display
        formatter.for_type("plotnine.ggplot.ggplot", display_plotnine_ggplot)

        return formatter

    @traitlets.default("formatters")
    def _formatters_default(self):
        formatters: dict[str, BaseFormatter] = super()._formatters_default()

        # Add PositronDataExplorerFormatter for inline data explorer
        explorer_formatter = create_data_explorer_formatter(parent=self, kernel=self.parent.kernel)
        formatters[explorer_formatter.format_type] = explorer_formatter

        return formatters


def display_plotnine_ggplot(obj: plotnine.ggplot) -> None:
    obj.draw(show=True)
