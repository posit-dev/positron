#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
from typing import List, Optional

from ..data_explorer_comm import (
    BackendState,
    ColumnSortKey,
    RowFilter,
    StrictStr,
)


class CodeFragment:
    """Represents a piece of generated code with its dependencies."""

    def __init__(self, preprocessing: Optional[List[str]] = None, method_chain: str = ""):
        self.preprocessing = preprocessing or []
        self.method_chain = method_chain


class CodeConverter:
    """Base class for generating dataframe code strings."""

    def __init__(self, table, state):
        """
        Initialize the code generator with a default DataFrame variable name.

        Args:
            table_name: Variable name to use for the DataFrame in generated code
            table: DataFrame or Series to generate code for
        """
        self.state: BackendState = state
        self.table_name: str = state.name
        self.table = table

    def convert(self, params) -> List[StrictStr]:
        """
        Convert operations to pandas code strings.

        Returns:
            List of code strings that perform the operations
        """
        preprocessing_lines = []
        method_chain_parts = [self.table_name]

        # Generate preprocessing and method chain parts
        filter_preprocessing, filter_chain = self._convert_filters(params.row_filters)
        sort_preprocessing, sort_chain = self._convert_sorts(params.sort_keys)

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

    def _convert_filters(
        self, row_filters: List[RowFilter]
    ) -> tuple[List[StrictStr], List[StrictStr]]:
        """
        Convert a list of RowFilter objects to a tuple of preprocessing and postprocessing code strings.

        Args:
            row_filters: List of RowFilter objects to convert

        Returns:
            Tuple containing preprocessing and postprocessing code strings
        """
        raise NotImplementedError("Subclasses must implement _convert_filters method")

    def _convert_sorts(
        self, sort_keys: List[ColumnSortKey]
    ) -> tuple[List[StrictStr], List[StrictStr]]:
        """
        Generate code for sorting.

        Returns:
            Tuple of (preprocessing_lines, method_chain_parts)
        """
        raise NotImplementedError("Subclasses must implement _convert_sorts method")
