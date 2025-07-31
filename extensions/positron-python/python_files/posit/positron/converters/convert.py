#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
from typing import List

from ..data_explorer_comm import (
    ConvertToCodeParams,
    StrictStr,
)


class MethodChainBuilder:
    """Helper class to build method chains from setup and chain parts."""

    def __init__(self, table_name: str):
        self.table_name = table_name
        self.setup_parts: List[StrictStr] = []
        self.chain_parts: List[StrictStr] = [table_name]

    def add_operation(self, setup: List[StrictStr], chain: List[StrictStr]) -> None:
        """Add setup and chain parts for an operation."""
        self.setup_parts.extend(setup)
        self.chain_parts.extend(chain)

    def build(self) -> List[StrictStr]:
        """Build the final code with setup and chained expression."""
        result = self.setup_parts.copy()

        if len(self.chain_parts) > 1:
            # Build the chained expression
            chained_expr = self.chain_parts[0]
            for part in self.chain_parts[1:]:
                chained_expr += part
            result.append(chained_expr)
        else:
            # Just the table name if no operations
            result.append(self.chain_parts[0])

        return result


class CodeConverter:
    """Base class for generating dataframe code strings."""

    def __init__(self, table, table_name: str, params: ConvertToCodeParams):
        """
        Initialize the code generator with a default DataFrame variable name.

        Args:
            table: DataFrame or Series to generate code for
            table_name: Name of the DataFrame variable in the generated code
            params: Parameters for conversion, including filters and sort keys
        """
        self.table = table
        self.table_name: str = table_name
        self.params: ConvertToCodeParams = params

    def convert(self) -> List[StrictStr]:
        """Convert operations to code strings."""
        builder = MethodChainBuilder(self.table_name)

        # Add operations to the builder
        filter_setup, filter_chain = self._convert_row_filters()
        sort_setup, sort_chain = self._convert_sort_keys()

        builder.add_operation(filter_setup, filter_chain)
        builder.add_operation(sort_setup, sort_chain)

        return builder.build()

    def _convert_row_filters(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """
        Convert a list of RowFilter objects to a tuple of code strings.

        Returns:
            Tuple containing preprocessing and method chain code strings
        """
        raise NotImplementedError("Subclasses must implement _convert_row_filters method")

    def _convert_column_filters(
        self,
    ) -> tuple[List[StrictStr], List[StrictStr]]:
        """
        Convert a list of ColumnFilter objects to a tuple of code strings.

        Returns:
            Tuple containing preprocessing and method chain code strings
        """
        raise NotImplementedError("Subclasses must implement _convert_column_filters method")

    def _convert_sort_keys(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """
        Convert a list of ColumnSortKey objects to a tuple of code strings.

        Returns:
            Tuple containing preprocessing and method chain code strings
        """
        raise NotImplementedError("Subclasses must implement _convert_sorts method")
