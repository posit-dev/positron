#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
from typing import List

from ..data_explorer_comm import (
    ConvertToCodeParams,
    StrictStr,
)


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
        preprocessing_lines = []
        method_chain_parts = [self.table_name]

        # Generate preprocessing and method chain parts
        filter_preprocessing, filter_chain = self._convert_row_filters()
        sort_preprocessing, sort_chain = self._convert_sorts()

        preprocessing_lines.extend([*filter_preprocessing, *sort_preprocessing])
        method_chain_parts.extend([*filter_chain, *sort_chain])

        # Combine preprocessing lines with the final chained expression
        result = preprocessing_lines.copy()
        if len(method_chain_parts) > 1:
            # Build the chained expression
            chained_expr = method_chain_parts[0]
            for part in method_chain_parts[1:]:
                chained_expr += part
            result.append(chained_expr)
        else:
            # Just the table name if no operations
            result.append(method_chain_parts[0])

        return result

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

    def _convert_sorts(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """
        Convert a list of ColumnSortKey objects to a tuple of code strings.

        Returns:
            Tuple containing preprocessing and method chain code strings
        """
        raise NotImplementedError("Subclasses must implement _convert_sorts method")
