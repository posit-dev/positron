#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
from typing import List

from ..data_explorer_comm import (
    BackendState,
    StrictStr,
)
from .convert import CodeConverter


class PolarsConverter(CodeConverter):
    def __init__(self, table, state: BackendState):
        """
        Initialize the Polars code generator.

        Args:
            table: DataFrame or Series to generate code for
            table_name: Variable name to use for the DataFrame in generated code
        """
        super().__init__(table, state)

    def convert(self, params) -> List[StrictStr]:
        """
        Convert operation specification to list of Polars code strings.

        Args:
            params: Parameters containing sort keys and filters

        Returns:
            List of code strings that perform the sort operation
        """
        raise NotImplementedError("Polars code generation not implemented yet.")
