#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from typing import List, Optional

import pandas as pd

from ..data_explorer_comm import (
    ColumnDisplayType,
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
from .convert import CodeConverter, ConvertToCodeParams


class PandasConverter(CodeConverter):
    def __init__(self, table, table_name: str, params: ConvertToCodeParams):
        super().__init__(table, table_name, params)

    def convert(self) -> List[StrictStr]:
        if self.params.code_syntax_name.code_syntax_name != "pandas":
            raise NotImplementedError(
                f"Code conversion for {self.params.code_syntax_name} is not implemented."
            )
        return super().convert()

    def _convert_row_filters(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """
        Generate code for filtering.

        Returns:
            Tuple of (preprocessing_lines, method_chain_parts)
        """
        preprocessing = []
        method_parts = []
        filters = self.params.row_filters

        if not filters:
            return preprocessing, method_parts

        comparisons = []
        for filter_key in filters:
            generator = PandasFilterConverter(filter_key, self.table_name)
            comparison = generator.convert_filters()
            if comparison:
                comparisons.append(comparison)

        if len(comparisons) == 1:
            # Single comparison, no need for filter mask
            method_parts.append(f"[{comparisons[0]}]")
        elif comparisons:
            preprocessing.append(f"filter_mask = {' & '.join(f'({comp})' for comp in comparisons)}")
            method_parts.append("[filter_mask]")

        return preprocessing, method_parts

    def _convert_sorts(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """
        Generate code for sorting.

        Returns:
            Tuple of (preprocessing_lines, method_chain_parts)
        """
        if not self.params.sort_keys:
            return [], []

        generator = PandasSortConverter(self.params.sort_keys, self.table)
        preprocessing, method_parts = generator.convert_sorts()

        return preprocessing, method_parts


class PandasSortConverter:
    def __init__(self, sort_keys: List[ColumnSortKey], table):
        self.sort_keys = sort_keys
        self.table = table

    def convert_sorts(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """Generate the sort string."""
        if len(self.sort_keys) == 1:
            return self._handle_single_sort()
        else:
            return self._handle_multi_sort()

    def _handle_single_sort(self) -> tuple[List[StrictStr], List[StrictStr]]:
        preprocessing = []
        method_parts = []

        sort_key = self.sort_keys[0]

        if isinstance(self.table, pd.Series):
            method_parts.append(f".sort_values(ascending={sort_key.ascending})")
        else:
            col_idx = sort_key.column_index
            column_name = self.table.columns[col_idx]
            method_parts.append(f".sort_values(by={column_name!r}, ascending={sort_key.ascending})")

        return preprocessing, method_parts

    def _handle_multi_sort(self) -> tuple[List[StrictStr], List[StrictStr]]:
        col_indices = [key.column_index for key in self.sort_keys]
        column_names = [self.table.columns[i] for i in col_indices]
        ascending_values = [sk.ascending for sk in self.sort_keys]

        preprocessing = [
            f"column_names = {column_names}",
            f"asc = {ascending_values}",
        ]

        method_parts = [".sort_values(by=column_names, ascending=asc)"]

        return preprocessing, method_parts


class PandasFilterConverter:
    def __init__(self, filter_key: RowFilter, table_name: str):
        self.filter_key = filter_key
        self.table_name = table_name
        self.column_name = repr(filter_key.column_schema.column_name)

    def convert_filters(self) -> Optional[str]:
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

        handler = filter_handlers.get(self.filter_key.filter_type)
        if handler:
            return handler()

        if isinstance(self.filter_key.params, FilterSetMembership):
            return None  # Currently not implemented

        return None

    def _handle_between_filter(self) -> str:
        assert isinstance(self.filter_key.params, FilterBetween)
        is_between = self.filter_key.filter_type == RowFilterType.Between
        left = self.filter_key.params.left_value
        right = self.filter_key.params.right_value
        operator = "" if is_between else "~"
        return f"{operator}{self.table_name}[{self.column_name}].between({left}, {right})"

    def _handle_compare_filter(self) -> str:
        """Handle comparison filters such as equals, not equals, greater than, etc."""
        assert isinstance(self.filter_key.params, FilterComparison)
        op = (
            "=="
            if self.filter_key.params.op.value == FilterComparisonOp.Eq
            else self.filter_key.params.op.value
        )

        value = self.filter_key.params.value

        if self.filter_key.column_schema.type_display == ColumnDisplayType.String:
            value = repr(value)

        elif self.filter_key.column_schema.type_display in [
            ColumnDisplayType.Datetime,
            ColumnDisplayType.Date,
        ]:
            tz = self.filter_key.column_schema.timezone
            value = "pd.Timestamp(" + repr(value)
            if tz:
                value += f", tz={tz!r}"
            value += ")"

        return f"{self.table_name}[{self.column_name}] {op} {value}"

    def _handle_text_search_filter(self) -> str:
        """Handle text search filters such as contains, regex, startswith, and endswith."""
        assert isinstance(self.filter_key.params, FilterTextSearch)

        column_access = f"{self.table_name}[{self.column_name}]"
        search_type = self.filter_key.params.search_type
        value = self.filter_key.params.term
        case_sensitive = self.filter_key.params.case_sensitive

        if search_type == TextSearchType.Contains:
            return f"{column_access}.str.contains({value!r}, case={case_sensitive}, na=False)"
        elif search_type == TextSearchType.NotContains:
            return f"~{column_access}.str.contains({value!r}, case={case_sensitive}, na=True)"
        elif search_type == TextSearchType.RegexMatch:
            return f"{column_access}.str.match({value!r}, case={case_sensitive}, na=False)"

        # no agruments for case sensitivity in startswith or endswith,
        # so we have to make everything lowercase
        if not case_sensitive:
            column_access = f"{column_access}.str.lower()"
            value = value.lower()

        if search_type == TextSearchType.StartsWith:
            return f"{column_access}.str.startswith({value!r}, na=False)"
        elif search_type == TextSearchType.EndsWith:
            return f"{column_access}.str.endswith({value!r}, na=False)"
        else:
            raise ValueError(f"Unsupported TextSearchType: {search_type}")

    def _handle_is_empty_filter(self) -> str:
        return f"{self.table_name}[{self.column_name}].str.len() == 0"

    def _handle_not_empty_filter(self) -> str:
        return f"{self.table_name}[{self.column_name}].str.len() != 0"

    def _handle_is_null_filter(self) -> str:
        return f"{self.table_name}[{self.column_name}].isna()"

    def _handle_not_null_filter(self) -> str:
        return f"{self.table_name}[{self.column_name}].notna()"

    def _handle_is_true_filter(self) -> str:
        return f"{self.table_name}[{self.column_name}] == True"

    def _handle_is_false_filter(self) -> str:
        return f"{self.table_name}[{self.column_name}] == False"
