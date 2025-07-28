#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from abc import ABC, abstractmethod
from sqlite3 import Row
from typing import List, Optional, Union

import pandas as pd

from ..data_explorer_comm import (
    BackendState,
    ColumnSortKey,
    FilterBetween,
    FilterComparison,
    FilterSetMembership,
    FilterTextSearch,
    RowFilter,
    RowFilterType,
    StrictStr,
    TextSearchType,
)
from ..third_party import is_pandas, is_polars


class CodeFragment:
    """Represents a piece of generated code with its dependencies."""

    def __init__(
        self,
        preprocessing: Optional[List[str]] = None,
        method_chain: str = "",
        postprocessing: Optional[List[str]] = None,
    ):
        self.preprocessing = preprocessing or []
        self.method_chain = method_chain
        self.postprocessing = postprocessing or []


class CodeConverter(ABC):
    """Class for generating dataframe code strings."""

    def __new__(cls, table, state: BackendState):
        """Factory method that returns appropriate code generator based on table type."""
        if cls is CodeConverter:
            if is_pandas(table):
                return PandasConverter(table, state)
            elif is_polars(table):
                return PolarsConverter(table, state)
        return super().__new__(cls)

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

    @abstractmethod
    def convert(self, params) -> List[StrictStr]:
        """Convert operation specification to list of pandas code strings."""


class PandasConverter(CodeConverter):
    def __init__(self, table: Union[pd.DataFrame, pd.Series], state: BackendState):
        """
        Initialize the sort code generator.

        Args:
            table: DataFrame or Series to generate code for
            state: Backend state containing filters and sort keys
        """
        super().__init__(table, state)

    def convert(self, params, *, create_new_df: bool = False) -> List[StrictStr]:
        """
        Convert operations to pandas code strings.

        Returns:
            List of code strings that perform the operations
        """
        preprocessing_lines = []
        method_chain_parts = [self.table_name]
        if create_new_df:
            # create a new DataFrame variable, primarily for testing purposes
            method_chain_parts = [f"new_df = {self.table_name}"]

        # Generate preprocessing and method chain parts
        filter_preprocessing, filter_chain = self._convert_filters(params.row_filters)
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

    def _convert_filters(
        self, row_filters: List[RowFilter]
    ) -> tuple[List[StrictStr], List[StrictStr]]:
        """
        Generate code for filtering.

        Returns:
            Tuple of (preprocessing_lines, method_chain_parts)
        """
        filter_keys = row_filters or self.state.row_filters

        preprocessing = []
        method_parts = []

        if not filter_keys:
            return preprocessing, method_parts

        comparisons = []
        for filter_key in filter_keys:
            # as of right now, we only support RowFilters
            assert isinstance(filter_key, RowFilter)
            column_name_repr = f"{filter_key.column_schema.column_name!r}"

            if filter_key.filter_type in (
                RowFilterType.Between,
                RowFilterType.NotBetween,
            ):
                assert isinstance(filter_key.params, FilterBetween)
                comparison = self._generate_between(
                    column_name_repr,
                    filter_key.params.left_value,
                    filter_key.params.right_value,
                    filter_key.filter_type,
                )
                comparisons.append(comparison)
            elif filter_key.filter_type == RowFilterType.Compare:
                assert isinstance(filter_key.params, FilterComparison)
                # Handle FilterComparison with custom operator
                comparison = self._generate_comparison(
                    column_name_repr,
                    filter_key.params.op.value,
                    filter_key.params.value,
                )
                comparisons.append(comparison)
            elif isinstance(filter_key.params, FilterTextSearch):
                comparison = self._generate_text_search(
                    column_name_repr,
                    filter_key.params.search_type,
                    filter_key.params.term,
                    case_sensitive=filter_key.params.case_sensitive,
                )
                comparisons.append(comparison)
            elif isinstance(filter_key.params, FilterSetMembership):
                pass
            elif filter_key.filter_type == RowFilterType.IsEmpty:
                # Handle is empty filter
                comparison = f"{self.table_name}[{column_name_repr}].str.len() == 0"
                comparisons.append(comparison)
            elif filter_key.filter_type == RowFilterType.NotEmpty:
                # Handle is empty filter
                comparison = f"{self.table_name}[{column_name_repr}].str.len() != 0"
                comparisons.append(comparison)
            elif filter_key.filter_type == RowFilterType.IsNull:
                # Handle is null filter
                comparison = f"{self.table_name}[{column_name_repr}].isna()"
                comparisons.append(comparison)
            elif filter_key.filter_type == RowFilterType.NotNull:
                # Handle is not null filter
                comparison = f"~{self.table_name}[{column_name_repr}].notna()"
                comparisons.append(comparison)
            elif filter_key.filter_type == RowFilterType.IsTrue:
                # Handle is true filter
                comparison = f"{self.table_name}[{column_name_repr} == True]"
                comparisons.append(comparison)
            elif filter_key.filter_type == RowFilterType.IsFalse:
                # Handle is false filter
                comparison = f"{self.table_name}[{column_name_repr} == False]"
                comparisons.append(comparison)

        if len(comparisons) == 1:
            # Single comparison, no need for filter mask
            method_parts.append(f"[{comparisons[0]}]")
        else:
            preprocessing.append(f"filter_mask = {' & '.join(f'({comp})' for comp in comparisons)}")
            method_parts.append("[filter_mask]")

        return preprocessing, method_parts

    def _generate_between(
        self,
        column_name: str,
        left_value,
        right_value,
        is_between: RowFilterType,
    ) -> StrictStr:
        """
        Generate code for a 'between' filter.

        Args:
            column_name: Name of the column to filter
            left_value: Left boundary value
            right_value: Right boundary value
            inclusive: Whether the range is inclusive

        Returns:
            A string representing the 'between' operation
        """
        if is_between == RowFilterType.Between:
            return f"({self.table_name}[{column_name}] >= {left_value} & {self.table_name}[{column_name}] <= {right_value})"
        elif is_between == RowFilterType.NotBetween:
            return f"({self.table_name}[{column_name}] < {left_value} | {self.table_name}[{column_name}] > {right_value})"
        else:
            raise ValueError(f"Unsupported RowFilterType: {is_between}")

    def _generate_comparison(self, column_name: str, operator: str, value) -> StrictStr:
        return f"{self.table_name}[{column_name}] {operator} {value}"

    def _generate_text_search(
        self,
        column_name: str,
        search_type: TextSearchType,
        value: str,
        *,
        case_sensitive: bool = True,
    ) -> StrictStr:
        """
        Generate code for text search filtering with optional case sensitivity.

        Args:
            column_name: Name of the column to filter
            search_type: Type of text search to perform
            value: Value to search for
            case_sensitive: Whether the search should be case-sensitive

        Returns:
            A string representing the text search operation
        """
        column_access = f"{self.table_name}[{column_name}].str"
        if not case_sensitive:
            column_access = f"{column_access}.lower()"
            value = value.lower()

        if search_type == TextSearchType.Contains:
            return f"{column_access}.contains({value!r})"
        elif search_type == TextSearchType.NotContains:
            return f"~{column_access}.contains({value!r})"
        elif search_type == TextSearchType.StartsWith:
            return f"{column_access}.startswith({value!r})"
        elif search_type == TextSearchType.EndsWith:
            return f"{column_access}.endswith({value!r})"
        elif search_type == TextSearchType.RegexMatch:
            return f"{column_access}.match({value!r})"
        else:
            raise ValueError(f"Unsupported TextSearchType: {search_type}")

    def _convert_sorts(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """
        Generate code for sorting.

        Returns:
            Tuple of (preprocessing_lines, method_chain_parts)
        """
        sort_keys = self.state.sort_keys
        preprocessing = []
        method_parts = []

        if len(sort_keys) == 0:
            return preprocessing, method_parts
        elif len(sort_keys) == 1:
            return self._single_sort(sort_keys[0])
        else:
            return self._multi_sort(sort_keys)

    def _single_sort(self, sort_key: ColumnSortKey) -> tuple[List[StrictStr], List[StrictStr]]:
        """Generate code for single column sort."""
        preprocessing = []
        method_parts = []

        if isinstance(self.table, pd.Series):
            method_parts.append(f".sort_values(ascending={sort_key.ascending})")
        else:
            col_idx = sort_key.column_index
            column_name = self.table.columns[col_idx]
            method_parts.append(f".sort_values(by={column_name}, ascending={sort_key.ascending})")

        return preprocessing, method_parts

    def _multi_sort(
        self, sort_keys: List[ColumnSortKey]
    ) -> tuple[List[StrictStr], List[StrictStr]]:
        """Generate code for multiple column sort."""
        col_indices = [sk.column_index for sk in sort_keys]
        ascending_values = [sk.ascending for sk in sort_keys]

        preprocessing = [
            f"column_indices = {col_indices}",
            f"column_names = [{self.table_name}.columns[i] for i in column_indices]",
            f"ascending_order = {ascending_values}",
        ]

        method_parts = [".sort_values(by=column_names, ascending=ascending_order)"]

        return preprocessing, method_parts


class PolarsConverter(CodeConverter):
    def __init__(self, table, table_name: str):
        """
        Initialize the Polars code generator.

        Args:
            table: DataFrame or Series to generate code for
            table_name: Variable name to use for the DataFrame in generated code
        """
        super().__init__(table, table_name)

    def convert(self, params) -> List[StrictStr]:
        """
        Convert operation specification to list of Polars code strings.

        Args:
            params: Parameters containing sort keys and filters

        Returns:
            List of code strings that perform the sort operation
        """
        raise NotImplementedError("Polars code generation not implemented yet.")
