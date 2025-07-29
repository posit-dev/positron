#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from typing import List, Optional, Union

import pandas as pd

from ..data_explorer_comm import (
    BackendState,
    ColumnSortKey,
    FilterBetween,
    FilterComparison,
    FilterComparisonOp,
    FilterSetMembership,
    FilterTextSearch,
    RowFilter,
    RowFilterType,
    StrictStr,
    TextSearchType,
)
from .convert import CodeConverter


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

            comparison = self._generate_filter_comparison(filter_key, column_name_repr)
            if comparison:
                comparisons.append(comparison)

        if len(comparisons) == 1:
            # Single comparison, no need for filter mask
            method_parts.append(f"[{comparisons[0]}]")
        elif comparisons:
            preprocessing.append(f"filter_mask = {' & '.join(f'({comp})' for comp in comparisons)}")
            method_parts.append("[filter_mask]")

        return preprocessing, method_parts

    def _generate_filter_comparison(
        self, filter_key: RowFilter, column_name_repr: str
    ) -> Optional[str]:
        """Generate comparison string for a single filter."""
        filter_handlers = {
            RowFilterType.Between: self._handle_between_filter,
            RowFilterType.NotBetween: self._handle_between_filter,
            RowFilterType.Compare: self._handle_compare_filter,
            RowFilterType.IsEmpty: self._handle_is_empty_filter,
            RowFilterType.NotEmpty: self._handle_not_empty_filter,
            RowFilterType.IsNull: self._handle_is_null_filter,
            RowFilterType.NotNull: self._handle_not_null_filter,
            RowFilterType.IsTrue: self._handle_is_true_filter,
            RowFilterType.IsFalse: self._handle_is_false_filter,
            RowFilterType.Search: self._handle_text_search_filter,
        }

        handler = filter_handlers.get(filter_key.filter_type)
        if handler:
            return handler(filter_key, column_name_repr)

        # Handle FilterTextSearch and FilterSetMembership by params type
        if isinstance(filter_key.params, FilterTextSearch):
            return self._generate_text_search(
                column_name_repr,
                filter_key.params.search_type,
                filter_key.params.term,
                case_sensitive=filter_key.params.case_sensitive,
            )
        elif isinstance(filter_key.params, FilterSetMembership):
            return None  # Currently not implemented

        return None

    def _handle_between_filter(self, filter_key: RowFilter, column_name_repr: str) -> str:
        assert isinstance(filter_key.params, FilterBetween)
        return self._generate_between(
            column_name_repr,
            filter_key.params.left_value,
            filter_key.params.right_value,
            filter_key.filter_type,
        )

    def _handle_compare_filter(self, filter_key: RowFilter, column_name_repr: str) -> str:
        assert isinstance(filter_key.params, FilterComparison)

        # TODO(iz): this is fine for number comparisons, but we need to handle strings and dt
        if filter_key.params.op == FilterComparisonOp.Eq:
            return self._generate_comparison(
                column_name_repr,
                "==",
                filter_key.params.value,
            )
        return self._generate_comparison(
            column_name_repr,
            filter_key.params.op.value,
            filter_key.params.value,
        )

    def _handle_text_search_filter(self, filter_key: RowFilter, column_name_repr: str) -> str:
        assert isinstance(filter_key.params, FilterTextSearch)
        return self._generate_text_search(
            column_name_repr,
            filter_key.params.search_type,
            filter_key.params.term,
            case_sensitive=filter_key.params.case_sensitive,
        )

    def _handle_is_empty_filter(self, filter_key: RowFilter, column_name_repr: str) -> str:
        return f"{self.table_name}[{column_name_repr}].str.len() == 0"

    def _handle_not_empty_filter(self, filter_key: RowFilter, column_name_repr: str) -> str:
        return f"{self.table_name}[{column_name_repr}].str.len() != 0"

    def _handle_is_null_filter(self, filter_key: RowFilter, column_name_repr: str) -> str:
        return f"{self.table_name}[{column_name_repr}].isna()"

    def _handle_not_null_filter(self, filter_key: RowFilter, column_name_repr: str) -> str:
        return f"{self.table_name}[{column_name_repr}].notna()"

    def _handle_is_true_filter(self, filter_key: RowFilter, column_name_repr: str) -> str:
        return f"{self.table_name}[{column_name_repr}] == True"

    def _handle_is_false_filter(self, filter_key: RowFilter, column_name_repr: str) -> str:
        return f"{self.table_name}[{column_name_repr}] == False"

    def _generate_between(
        self,
        column_name: str,
        left_value,
        right_value,
        filter_type: RowFilterType,
    ) -> StrictStr:
        """
        Generate code for a 'between' or 'not between' filter.

        Args:
            column_name: Name of the column to filter
            left_value: Left boundary value
            right_value: Right boundary value
            filter_type: Type of filter (Between or NotBetween)

        Returns:
            A string representing the 'between' or 'not between' operation
        """
        is_between = filter_type == RowFilterType.Between
        operator = "" if is_between else "~"
        return f"{operator}{self.table_name}[{column_name}].between({left_value}, {right_value})"

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
        column_access = f"{self.table_name}[{column_name}]"

        if search_type == TextSearchType.Contains:
            return f"{column_access}.str.contains({value!r}, case={case_sensitive}, na=False)"
        elif search_type == TextSearchType.NotContains:
            return f"~{column_access}.str.contains({value!r}, case={case_sensitive}, na=True)"
        elif search_type == TextSearchType.RegexMatch:
            return f"{column_access}.str.match({value!r}, case={case_sensitive}, na=False)"

        if not case_sensitive:
            column_access = f"{column_access}.str.lower()"
            value = value.lower()

        if search_type == TextSearchType.StartsWith:
            return f"{column_access}.str.startswith({value!r}, na = False)"
        elif search_type == TextSearchType.EndsWith:
            return f"{column_access}.str.endswith({value!r}, na = False)"
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
            method_parts.append(f".sort_values(by={column_name!r}, ascending={sort_key.ascending})")

        return preprocessing, method_parts

    def _multi_sort(
        self, sort_keys: List[ColumnSortKey]
    ) -> tuple[List[StrictStr], List[StrictStr]]:
        """Generate code for multiple column sort."""
        col_indices = [sk.column_index for sk in sort_keys]
        column_names = [self.table.columns[i] for i in col_indices]
        ascending_values = [sk.ascending for sk in sort_keys]

        preprocessing = [
            f"column_names = {column_names}",
            f"asc = {ascending_values}",
        ]

        method_parts = [".sort_values(by=column_names, ascending=asc)"]

        return preprocessing, method_parts
