#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
from typing import List, Optional

from .data_explorer_comm import (
    ColumnDisplayType,
    ColumnSortKey,
    ConvertToCodeParams,
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


class MethodChainBuilder:
    """Helper class to build method chains from setup and chain parts."""

    def __init__(self, table_name: str):
        self.table_name = table_name
        self.setup_parts: List[StrictStr] = []
        self.chain_parts: List[StrictStr] = [table_name]

    def add_operation(self, setup: List[StrictStr], chain: List[StrictStr]) -> None:
        """Add setup and chain parts for an operation.

        Parameters
        ----------
        setup : List[StrictStr]
            Setup code parts to add.
        chain : List[StrictStr]
            Chain code parts to add.
        """
        self.setup_parts.extend(setup)
        self.chain_parts.extend(chain)

    def build(self) -> List[StrictStr]:
        """Build the final code with setup and chained expression.

        Returns
        -------
        List[StrictStr]
            Final code with setup and chained expression.
        """
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
        """Initialize the code generator with a default DataFrame variable name.

        Parameters
        ----------
        table : DataFrame or Series
            DataFrame or Series to generate code for.
        table_name : str
            Name of the DataFrame variable in the generated code.
        params : ConvertToCodeParams
            Parameters for conversion, including filters and sort keys.
        """
        self.table = table
        self.table_name: str = table_name
        self.params: ConvertToCodeParams = params

    def convert(self) -> List[StrictStr]:
        """Convert operations to code strings.

        Returns
        -------
        List[StrictStr]
            Generated code strings.
        """
        builder = MethodChainBuilder(self.table_name)

        # Add operations to the builder
        filter_setup, filter_chain = self._convert_row_filters()
        sort_setup, sort_chain = self._convert_sort_keys()

        builder.add_operation(filter_setup, filter_chain)
        builder.add_operation(sort_setup, sort_chain)

        return builder.build()

    def _convert_row_filters(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """Convert a list of RowFilter objects to a tuple of code strings.

        Returns
        -------
        tuple[List[StrictStr], List[StrictStr]]
            Tuple containing preprocessing and method chain code strings.
        """
        raise NotImplementedError("Subclasses must implement _convert_row_filters method")

    def _convert_column_filters(
        self,
    ) -> tuple[List[StrictStr], List[StrictStr]]:
        """Convert a list of ColumnFilter objects to a tuple of code strings.

        Returns
        -------
        tuple[List[StrictStr], List[StrictStr]]
            Tuple containing preprocessing and method chain code strings.
        """
        raise NotImplementedError("Subclasses must implement _convert_column_filters method")

    def _convert_sort_keys(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """Convert a list of ColumnSortKey objects to a tuple of code strings.

        Returns
        -------
        tuple[List[StrictStr], List[StrictStr]]
            Tuple containing preprocessing and method chain code strings.
        """
        raise NotImplementedError("Subclasses must implement _convert_sorts method")


class PandasConverter(CodeConverter):
    def __init__(
        self, table, table_name: str, params: ConvertToCodeParams, *, was_series: bool = False
    ):
        self.was_series = was_series
        super().__init__(table, table_name, params)

    def convert(self) -> List[StrictStr]:
        if self.params.code_syntax_name.code_syntax_name != "pandas":
            raise NotImplementedError(
                f"Code conversion for {self.params.code_syntax_name} is not implemented."
            )
        return super().convert()

    def _convert_row_filters(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """Take filters and convert them to code strings.

        Returns
        -------
        tuple[List[StrictStr], List[StrictStr]]
            Tuple of (method_chain_setup, method_chain_parts).
        """
        method_chain_setup = []
        method_chain_parts = []
        filters = self.params.row_filters

        if not filters:
            return method_chain_setup, method_chain_parts

        comparisons = []
        # process each filter key to some comparison string
        # that can be used in the method chain
        for filter_key in filters:
            handler = PandasFilterHandler(filter_key, self.table_name, was_series=self.was_series)
            comparison = handler.convert_filters()
            if comparison:
                comparisons.append(comparison)

        if len(comparisons) == 1:
            # Single comparison, no need for filter mask
            method_chain_parts.append(f"[{comparisons[0]}]")
        elif comparisons:
            method_chain_setup.append(
                f"filter_mask = {' & '.join(f'({comp})' for comp in comparisons)}"
            )
            method_chain_parts.append("[filter_mask]")

        return method_chain_setup, method_chain_parts

    def _convert_sort_keys(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """Generate code for sorting.

        Returns
        -------
        tuple[List[StrictStr], List[StrictStr]]
            Tuple of (method_chain_setup, method_chain_parts).
        """
        if not self.params.sort_keys:
            return [], []

        handler = PandasSortHandler(self.params.sort_keys, self.table, was_series=self.was_series)
        method_chain_setup, method_chain_parts = handler.convert_sorts()

        return method_chain_setup, method_chain_parts


class PandasSortHandler:
    def __init__(self, sort_keys: List[ColumnSortKey], table, *, was_series: bool = False):
        self.sort_keys = sort_keys
        self.table = table
        self.was_series = was_series

    def convert_sorts(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """Handle the sort string.

        Returns
        -------
        tuple[List[StrictStr], List[StrictStr]]
            Tuple of (method_chain_setup, method_chain_parts).
        """
        if len(self.sort_keys) == 1:
            return self._convert_single_sort()
        else:
            return self._convert_multi_sort()

    def _convert_single_sort(self) -> tuple[List[StrictStr], List[StrictStr]]:
        method_chain_setup = []
        method_chain_parts = []

        sort_key = self.sort_keys[0]

        if self.was_series:
            method_chain_parts.append(f".sort_values(ascending={sort_key.ascending})")
        else:
            col_idx = sort_key.column_index
            column_name = self.table.columns[col_idx]
            method_chain_parts.append(
                f".sort_values(by={column_name!r}, ascending={sort_key.ascending})"
            )

        return method_chain_setup, method_chain_parts

    def _convert_multi_sort(self) -> tuple[List[StrictStr], List[StrictStr]]:
        col_indices = [key.column_index for key in self.sort_keys]
        column_names = [self.table.columns[i] for i in col_indices]
        ascending_values = [sk.ascending for sk in self.sort_keys]

        method_chain_setup = [
            f"column_names = {column_names}",
            f"asc = {ascending_values}",
        ]

        method_chain_parts = [".sort_values(by=column_names, ascending=asc)"]

        return method_chain_setup, method_chain_parts


class PandasFilterHandler:
    def __init__(self, filter_key: RowFilter, table_name: str, *, was_series: bool = False):
        self.filter_key = filter_key
        self.table_name = table_name
        self.column_name = "" if was_series else f"[{filter_key.column_schema.column_name!r}]"

    def convert_filters(self) -> Optional[str]:
        filter_handlers = {
            RowFilterType.Between: self._convert_between_filter,
            RowFilterType.NotBetween: self._convert_between_filter,
            RowFilterType.Compare: self._convert_compare_filter,
            RowFilterType.IsEmpty: self._convert_is_empty_filter,
            RowFilterType.NotEmpty: self._convert_not_empty_filter,
            RowFilterType.IsNull: self._convert_is_null_filter,
            RowFilterType.NotNull: self._convert_not_null_filter,
            RowFilterType.IsTrue: self._convert_is_true_filter,
            RowFilterType.IsFalse: self._convert_is_false_filter,
            RowFilterType.Search: self._convert_text_search_filter,
        }

        handler = filter_handlers.get(self.filter_key.filter_type)
        if handler:
            return handler()

        if isinstance(self.filter_key.params, FilterSetMembership):
            return None  # Currently not implemented

        return None

    def _convert_between_filter(self) -> str:
        assert isinstance(self.filter_key.params, FilterBetween)
        is_between = self.filter_key.filter_type == RowFilterType.Between
        left = self.filter_key.params.left_value
        right = self.filter_key.params.right_value
        operator = "" if is_between else "~"
        return f"{operator}{self.table_name}{self.column_name}.between({left}, {right})"

    def _convert_compare_filter(self) -> str:
        """Handle comparison filters such as equals, not equals, greater than, etc.

        Returns
        -------
        str
            Filter comparison code string.
        """
        assert isinstance(self.filter_key.params, FilterComparison)
        op = (
            "=="
            if self.filter_key.params.op.value == FilterComparisonOp.Eq
            else self.filter_key.params.op.value
        )

        value = self.filter_key.params.value

        if self.filter_key.column_schema.type_display == ColumnDisplayType.String:
            value = repr(value)

        # if it looks date-like, make it a Timestamp, which allows us to handle timezones
        elif self.filter_key.column_schema.type_display in [
            ColumnDisplayType.Datetime,
            ColumnDisplayType.Date,
        ]:
            tz = self.filter_key.column_schema.timezone
            value = "pd.Timestamp(" + repr(value)
            if tz:
                value += f", tz={tz!r}"
            value += ")"

        return f"{self.table_name}{self.column_name} {op} {value}"

    def _convert_text_search_filter(self) -> str:
        """Handle text search filters such as contains, regex, startswith, and endswith.

        Returns
        -------
        str
            Text search filter code string.
        """
        assert isinstance(self.filter_key.params, FilterTextSearch)

        column_access = f"{self.table_name}{self.column_name}"
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

    def _convert_is_empty_filter(self) -> str:
        return f"{self.table_name}{self.column_name}.str.len() == 0"

    def _convert_not_empty_filter(self) -> str:
        return f"{self.table_name}{self.column_name}.str.len() != 0"

    def _convert_is_null_filter(self) -> str:
        return f"{self.table_name}{self.column_name}.isna()"

    def _convert_not_null_filter(self) -> str:
        return f"{self.table_name}{self.column_name}.notna()"

    def _convert_is_true_filter(self) -> str:
        return f"{self.table_name}{self.column_name} == True"

    def _convert_is_false_filter(self) -> str:
        return f"{self.table_name}{self.column_name} == False"
