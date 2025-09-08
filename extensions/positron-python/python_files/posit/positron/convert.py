#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

# ruff: noqa: PIE790
import abc
from typing import List, Optional, Type

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

        # if there are multiple method chain parts,
        # we need to join them into a single expression
        if len(self.chain_parts) > 1:
            chained_expr = self.chain_parts[0]
            for part in self.chain_parts[1:]:
                chained_expr += part
            result.append(chained_expr)
        else:
            # Just the table name if no operations
            result.append(self.chain_parts[0])

        return result


class SortHandler:
    """Base class for sort handlers."""

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

    @abc.abstractmethod
    def _convert_single_sort(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """Convert a single sort key to code.

        Returns
        -------
        tuple[List[StrictStr], List[StrictStr]]
            Tuple of (method_chain_setup, method_chain_parts).
        """
        pass

    @abc.abstractmethod
    def _convert_multi_sort(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """Convert multiple sort keys to code.

        Returns
        -------
        tuple[List[StrictStr], List[StrictStr]]
            Tuple of (method_chain_setup, method_chain_parts).
        """
        pass

    def _get_column_names_from_indices(self) -> List[str]:
        """Extract column names from indices.

        Returns
        -------
        List[str]
            List of column names.
        """
        col_indices = [key.column_index for key in self.sort_keys]
        return [self.table.columns[i] for i in col_indices]


class PandasSortHandler(SortHandler):
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
        column_names = self._get_column_names_from_indices()
        ascending_values = [sk.ascending for sk in self.sort_keys]

        method_chain_setup = [
            f"column_names = {column_names}",
            f"asc = {ascending_values}",
        ]

        method_chain_parts = [".sort_values(by=column_names, ascending=asc)"]

        return method_chain_setup, method_chain_parts


class PolarsSortHandler(SortHandler):
    def _convert_single_sort(self) -> tuple[List[StrictStr], List[StrictStr]]:
        method_chain_setup = []
        method_chain_parts = []

        sort_key = self.sort_keys[0]
        col_idx = sort_key.column_index
        column_name = self.table.columns[col_idx]

        # In polars we use .sort() instead of .sort_values()
        # and descending instead of ascending=False
        if sort_key.ascending:
            method_chain_parts.append(f".sort({column_name!r})")
        else:
            method_chain_parts.append(f".sort({column_name!r}, descending=True)")

        return method_chain_setup, method_chain_parts

    def _convert_multi_sort(self) -> tuple[List[StrictStr], List[StrictStr]]:
        column_names = self._get_column_names_from_indices()
        descending_values = [not sk.ascending for sk in self.sort_keys]

        # For polars, we use a list of columns and a separate descending parameter
        method_chain_setup = [
            f"sort_columns = {column_names}",
            f"descending = {descending_values}",
        ]

        method_chain_parts = [".sort(sort_columns, descending=descending)"]

        return method_chain_setup, method_chain_parts


class FilterHandler:
    """Base class for filter handlers."""

    def __init__(self, filter_key: RowFilter, table_name: str, *, was_series: bool = False):
        self.filter_key = filter_key
        self.table_name = table_name
        self.column_name = "" if was_series else f"[{filter_key.column_schema.column_name!r}]"
        self.filter_handlers = {
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

    def convert_filters(self) -> Optional[str]:
        """Convert filter to code string.

        Returns
        -------
        Optional[str]
            Filter code string or None if not implemented.
        """
        handler = self.filter_handlers.get(self.filter_key.filter_type)
        if handler:
            return handler()

        if isinstance(self.filter_key.params, FilterSetMembership):
            return None  # Currently not implemented

        return None

    @abc.abstractmethod
    def _convert_between_filter(self) -> str:
        pass

    @abc.abstractmethod
    def _convert_compare_filter(self) -> str:
        pass

    @abc.abstractmethod
    def _convert_text_search_filter(self) -> str:
        pass

    @abc.abstractmethod
    def _convert_is_empty_filter(self) -> str:
        pass

    @abc.abstractmethod
    def _convert_not_empty_filter(self) -> str:
        pass

    @abc.abstractmethod
    def _convert_is_null_filter(self) -> str:
        pass

    @abc.abstractmethod
    def _convert_not_null_filter(self) -> str:
        pass

    @abc.abstractmethod
    def _convert_is_true_filter(self) -> str:
        pass

    @abc.abstractmethod
    def _convert_is_false_filter(self) -> str:
        pass


class PandasFilterHandler(FilterHandler):
    def _format_value(self, value):
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
        return value

    def _convert_between_filter(self) -> str:
        assert isinstance(self.filter_key.params, FilterBetween)
        is_between = self.filter_key.filter_type == RowFilterType.Between
        operator = "" if is_between else "~"

        left = self.filter_key.params.left_value
        right = self.filter_key.params.right_value
        return f"{operator}{self.table_name}{self.column_name}.between({left}, {right})"

    def _convert_compare_filter(self) -> str:
        assert isinstance(self.filter_key.params, FilterComparison)
        # need to handle equality operator, since we want == to determine equality, not =
        op = (
            "=="
            if self.filter_key.params.op.value == FilterComparisonOp.Eq
            else self.filter_key.params.op.value
        )

        value = self._format_value(self.filter_key.params.value)

        return f"{self.table_name}{self.column_name} {op} {value}"

    def _convert_text_search_filter(self) -> str:
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


class PolarsFilterHandler(FilterHandler):
    def __init__(self, filter_key: RowFilter, table_name: str, *, was_series: bool = False):
        super().__init__(filter_key, table_name, was_series=was_series)
        # In Polars, we use column expressions without the DataFrame reference
        self.col_expr = f"pl.col({filter_key.column_schema.column_name!r})"

    def _format_value(self, value):
        if self.filter_key.column_schema.type_display == ColumnDisplayType.String:
            value = repr(value)

        # Handle date-like values for Polars
        elif self.filter_key.column_schema.type_display in [
            ColumnDisplayType.Datetime,
            ColumnDisplayType.Date,
        ]:
            value = f"pl.lit({value!r}).str.to_datetime("
            tz = self.filter_key.column_schema.timezone
            if tz:
                value += f"time_zone={tz!r}"
            value += ")"
        return value

    def _convert_between_filter(self) -> str:
        assert isinstance(self.filter_key.params, FilterBetween)
        is_between = self.filter_key.filter_type == RowFilterType.Between
        left = self.filter_key.params.left_value
        right = self.filter_key.params.right_value

        # Polars uses .is_between() function
        if is_between:
            return f"{self.col_expr}.is_between({left}, {right})"
        else:
            return f"~{self.col_expr}.is_between({left}, {right})"

    def _convert_compare_filter(self) -> str:
        assert isinstance(self.filter_key.params, FilterComparison)
        op = (
            "=="
            if self.filter_key.params.op.value == FilterComparisonOp.Eq
            else self.filter_key.params.op.value
        )

        value = self._format_value(self.filter_key.params.value)

        return f"{self.col_expr} {op} {value}"

    def _convert_text_search_filter(self) -> str:
        assert isinstance(self.filter_key.params, FilterTextSearch)

        search_type = self.filter_key.params.search_type
        value = self.filter_key.params.term
        case_sensitive = self.filter_key.params.case_sensitive

        # use regex for all case sensitive searches, as recommended by Polars
        if not case_sensitive:
            value = "(?i)" + value

        if search_type == TextSearchType.Contains:
            return f"{self.col_expr}.str.contains({value!r})"
        elif search_type == TextSearchType.NotContains:
            return f"~{self.col_expr}.str.contains({value!r})"
        elif search_type == TextSearchType.RegexMatch:
            return f"{self.col_expr}.str.contains({value!r})"
        elif search_type == TextSearchType.StartsWith:
            return f"{self.col_expr}.str.starts_with({value!r})"
        elif search_type == TextSearchType.EndsWith:
            return f"{self.col_expr}.str.ends_with({value!r})"
        else:
            raise ValueError(f"Unsupported TextSearchType: {search_type}")

    def _convert_is_empty_filter(self) -> str:
        return f"{self.col_expr}.str.len_chars() == 0"

    def _convert_not_empty_filter(self) -> str:
        return f"{self.col_expr}.str.len_chars() > 0"

    def _convert_is_null_filter(self) -> str:
        return f"{self.col_expr}.is_null()"

    def _convert_not_null_filter(self) -> str:
        return f"{self.col_expr}.is_not_null()"

    def _convert_is_true_filter(self) -> str:
        return f"{self.col_expr} == True"

    def _convert_is_false_filter(self) -> str:
        return f"{self.col_expr} == False"


class CodeConverter:
    """Base class for generating dataframe code strings."""

    filter_handler_class: Optional[Type[FilterHandler]] = None
    sort_handler_class: Optional[Type[SortHandler]] = None

    def __init__(
        self,
        table,
        table_name: str,
        params: ConvertToCodeParams,
        *,
        was_series: bool = False,
        sql_string: Optional[str] = None,
    ):
        self.table = table
        self.table_name: str = table_name
        self.params: ConvertToCodeParams = params
        self.was_series = was_series
        self.syntax_name = params.code_syntax_name.code_syntax_name
        self.sql_string = sql_string

    def build_code(self) -> List[StrictStr]:
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
        if self.sql_string:
            sql = ["# Load table into pandas dataframe, eg:", self.sql_string]
            builder.add_operation(sql, [])
        builder.add_operation(filter_setup, filter_chain)
        builder.add_operation(sort_setup, sort_chain)

        return builder.build()

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

        if not self.filter_handler_class or not filters:
            return method_chain_setup, method_chain_parts

        comparisons = []
        # process each filter key to some comparison string
        # that can be used in the method chain
        for filter_key in filters:
            handler = self.filter_handler_class(
                filter_key, self.table_name, was_series=self.was_series
            )
            comparison = handler.convert_filters()
            if comparison:
                comparisons.append(comparison)

        method_chain_setup, method_chain_parts = self._format_filter(comparisons)

        return method_chain_setup, method_chain_parts

    @abc.abstractmethod
    def _convert_column_filters(
        self,
    ) -> tuple[List[StrictStr], List[StrictStr]]:
        """Convert a list of ColumnFilter objects to a tuple of code strings.

        Returns
        -------
        tuple[List[StrictStr], List[StrictStr]]
            Tuple containing preprocessing and method chain code strings.
        """
        pass

    def _convert_sort_keys(self) -> tuple[List[StrictStr], List[StrictStr]]:
        """Generate code for sorting.

        Returns
        -------
        tuple[List[StrictStr], List[StrictStr]]
            Tuple of (method_chain_setup, method_chain_parts).
        """
        if not self.params.sort_keys or not self.sort_handler_class:
            return [], []

        handler = self.sort_handler_class(
            self.params.sort_keys, self.table, was_series=self.was_series
        )
        method_chain_setup, method_chain_parts = handler.convert_sorts()

        return method_chain_setup, method_chain_parts

    @abc.abstractmethod
    def _format_filter(self, comparisons: List[str]) -> tuple[List[StrictStr], List[StrictStr]]:
        """Format multiple filter comparisons into method chain parts.

        Parameters
        ----------
        comparisons : List[str]
            List of comparison strings to format.

        Returns
        -------
        tuple[List[StrictStr], List[StrictStr]]
            Tuple of setup and method chain parts.
        """
        pass


class PandasConverter(CodeConverter):
    filter_handler_class = PandasFilterHandler
    sort_handler_class = PandasSortHandler

    def _format_filter(self, comparisons: List[str]) -> tuple[List[StrictStr], List[StrictStr]]:
        # Multiple comparisons, create filter mask
        if len(comparisons) == 1:
            return [], [f"[{comparisons[0]}]"]
        setup = [f"filter_mask = {' & '.join(f'({comp})' for comp in comparisons)}"]
        parts = ["[filter_mask]"]
        return setup, parts


class PolarsConverter(CodeConverter):
    filter_handler_class = PolarsFilterHandler
    sort_handler_class = PolarsSortHandler

    def build_code(self) -> List[StrictStr]:
        code = super().build_code()
        if self.params.code_syntax_name.code_syntax_name == "pandas":
            # Append .to_pandas() to the end of the method chain for Polars conversion
            code[-1] = code[-1] + ".to_pandas()"
        return code

    def _format_filter(self, comparisons: List[str]) -> tuple[List[StrictStr], List[StrictStr]]:
        if len(comparisons) == 1:
            # If there's only one comparison, use it directly
            return [], [f".filter({comparisons[0]})"]
        # Multiple comparisons, create expression and use .filter() method
        setup = [f"filter_expr = {' & '.join(f'({comp})' for comp in comparisons)}"]
        parts = [".filter(filter_expr)"]
        return setup, parts


class IbisConverter:
    """Converts Ibis expressions to code."""

    def __init__(self, table, name, request):
        """Initialize the converter with the table and parameters."""
        self.table = table
        self.name = name
        self.request = request
        self.sql_string = getattr(table, "_source_sql", None)

    def build_code(self):
        """Build the code representation of the table with any filters and sorts applied."""
        code_parts = []

        # If we have a SQL string, use that as the starting point
        if self.sql_string:
            code_parts.append(f"{self.name} = ibis.sql('''\n{self.sql_string}\n''')")
            return "\n".join(code_parts)

        # Otherwise use the table as-is
        code_parts.append(f"# Working with {self.name}")

        # Add filters if present in the request
        if hasattr(self.request, "row_filters") and self.request.row_filters:
            for filt in self.request.row_filters:
                if filt.filter_type == RowFilterType.Compare:
                    params = filt.params
                    assert isinstance(params, FilterComparison)
                    col_name = filt.column_schema.column_name
                    op_map = {
                        FilterComparisonOp.Eq: "==",
                        FilterComparisonOp.NotEq: "!=",
                        FilterComparisonOp.Gt: ">",
                        FilterComparisonOp.GtEq: ">=",
                        FilterComparisonOp.Lt: "<",
                        FilterComparisonOp.LtEq: "<=",
                    }
                    op = op_map.get(params.op, "==")
                    code_parts.append(
                        f"{self.name} = {self.name}.filter({self.name}['{col_name}'] {op} {params.value!r})"
                    )

                elif filt.filter_type == RowFilterType.Between:
                    params = filt.params
                    assert isinstance(params, FilterBetween)
                    col_name = filt.column_schema.column_name
                    code_parts.append(
                        f"{self.name} = {self.name}.filter(({self.name}['{col_name}'] >= {params.left_value!r}) & "
                        f"({self.name}['{col_name}'] <= {params.right_value!r}))"
                    )

                elif filt.filter_type == RowFilterType.NotBetween:
                    params = filt.params
                    assert isinstance(params, FilterBetween)
                    col_name = filt.column_schema.column_name
                    code_parts.append(
                        f"{self.name} = {self.name}.filter(({self.name}['{col_name}'] < {params.left_value!r}) | "
                        f"({self.name}['{col_name}'] > {params.right_value!r}))"
                    )

                elif filt.filter_type == RowFilterType.IsNull:
                    col_name = filt.column_schema.column_name
                    code_parts.append(
                        f"{self.name} = {self.name}.filter({self.name}['{col_name}'].isnull())"
                    )

                elif filt.filter_type == RowFilterType.NotNull:
                    col_name = filt.column_schema.column_name
                    code_parts.append(
                        f"{self.name} = {self.name}.filter({self.name}['{col_name}'].notnull())"
                    )

        # Add sort if present in the request
        if hasattr(self.request, "sort_keys") and self.request.sort_keys:
            sort_cols = []
            for key in self.request.sort_keys:
                col_name = self.table.columns[key.column_index]
                if key.ascending:
                    sort_cols.append(f"{self.name}['{col_name}'].asc()")
                else:
                    sort_cols.append(f"{self.name}['{col_name}'].desc()")

            if sort_cols:
                sort_expr = ", ".join(sort_cols)
                code_parts.append(f"{self.name} = {self.name}.order_by({sort_expr})")

        return "\n".join(code_parts)
