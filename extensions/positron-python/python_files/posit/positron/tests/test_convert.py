import datetime

import pandas as pd
import pytz

from ..data_explorer_comm import CodeSyntaxName, FilterComparisonOp
from ..utils import var_guid
from .test_data_explorer import (
    COMPARE_OPS,
    SIMPLE_PANDAS_DF,
    DataExplorerFixture,
    _between_filter,
    _compare_filter,
    _filter,
    _not_between_filter,
    _search_filter,
)


# ruff: noqa: E712
class DataExplorerConvertFixture(DataExplorerFixture):
    def convert_to_code(
        self,
        table_name,
        column_filters=None,
        row_filters=None,
        sort_keys=None,
        code_syntax_name="",
    ):
        return self.do_json_rpc(
            table_name,
            "convert_to_code",
            column_filters=column_filters or [],
            row_filters=row_filters or [],
            sort_keys=sort_keys or [],
            code_syntax_name=CodeSyntaxName(code_syntax_name=code_syntax_name),
        )

    def check_conversion_case(
        self,
        table,
        expected_table,
        column_filters=None,
        row_filters=None,
        sort_keys=None,
        code_syntax_name="pandas",
    ):
        table_id = var_guid()
        ex_id = var_guid()
        self.register_table(table_id, table)
        self.register_table(ex_id, expected_table)

        response = self.convert_to_code(
            table_id, column_filters, row_filters, sort_keys, code_syntax_name
        )
        assert response["converted_code"] is not None

        new_df_code = response["converted_code"]

        # added to ensure the new table is created in the shell's user namespace
        # normally we dont want to create a new dataframe in this code
        new_table_id = var_guid()
        new_df_code[-1] = new_table_id + " = " + new_df_code[-1]
        new_df_code = "\n".join(new_df_code)
        self.shell.user_ns[table_id] = table

        self.shell.run_cell(new_df_code).raise_error()

        new_df = pd.DataFrame(self.shell.user_ns[new_table_id])
        self.register_table(new_table_id, new_df)
        self.compare_tables(new_table_id, ex_id, table.shape)


def test_convert_pandas_filter_is_null_true(dxf: DataExplorerConvertFixture):
    test_df = SIMPLE_PANDAS_DF
    schema = dxf.get_schema_for(test_df)
    b_is_null = _filter("is_null", schema[1])
    b_not_null = _filter("not_null", schema[1])
    b_is_true = _filter("is_true", schema[1])
    b_is_false = _filter("is_false", schema[1])
    c_not_null = _filter("not_null", schema[2])

    cases = [
        [
            [b_is_null],
            test_df[test_df["b"].isna()],
        ],
        [
            [b_not_null],
            test_df[test_df["b"].notna()],
        ],
        [
            [b_is_true],
            test_df[test_df["b"] == True],
        ],
        [
            [b_is_false],
            test_df[test_df["b"] == False],
        ],
        [
            [b_not_null, c_not_null],
            test_df[test_df["b"].notna() & test_df["c"].notna()],
        ],
    ]

    for filter_set, expected_df in cases:
        dxf.check_conversion_case(
            test_df, expected_df, row_filters=filter_set, code_syntax_name="pandas"
        )


def test_convert_pandas_filter_empty(dxf: DataExplorerConvertFixture):
    test_df = pd.DataFrame(
        {
            "a": ["foo1", "foo2", "", "2FOO", "FOO3", "bar1", "2BAR"],
            "b": [1, 11, 31, 22, 24, 62, 89],
        }
    )

    dxf.register_table("test_df", test_df)
    schema = dxf.get_schema("test_df")
    a_is_empty = _filter("is_empty", schema[0])
    a_is_not_empty = _filter("not_empty", schema[0])

    cases = [
        [
            [a_is_empty],
            test_df[test_df["a"].str.len() == 0],
        ],
        [
            [a_is_not_empty],
            test_df[test_df["a"].str.len() > 0],
        ],
    ]
    for filter_set, expected_df in cases:
        dxf.check_conversion_case(
            test_df, expected_df, row_filters=filter_set, code_syntax_name="pandas"
        )


def test_convert_pandas_filter_search(dxf: DataExplorerConvertFixture):
    test_df = pd.DataFrame(
        {
            "a": ["foo1", "foo2", None, "2FOO", "FOO3", "bar1", "2BAR"],
            "b": [1, 11, 31, 22, 24, 62, 89],
        }
    )

    dxf.register_table("test_df", test_df)
    schema = dxf.get_schema("test_df")

    # (search_type, column_schema, term, case_sensitive, boolean mask)
    # TODO (iz): make this more DRY since we have another test for search filters
    cases = [
        (
            "contains",
            schema[0],
            "foo",
            False,
            test_df["a"].str.lower().str.contains("foo"),
        ),
        ("contains", schema[0], "foo", True, test_df["a"].str.contains("foo")),
        (
            "not_contains",
            schema[0],
            "foo",
            False,
            ~test_df["a"].str.lower().str.contains("foo", na=True),
        ),
        (
            "not_contains",
            schema[0],
            "foo",
            True,
            ~test_df["a"].str.contains("foo", na=True),
        ),
        (
            "starts_with",
            schema[0],
            "foo",
            False,
            test_df["a"].str.lower().str.startswith("foo"),
        ),
        (
            "starts_with",
            schema[0],
            "foo",
            True,
            test_df["a"].str.startswith("foo"),
        ),
        (
            "ends_with",
            schema[0],
            "foo",
            False,
            test_df["a"].str.lower().str.endswith("foo"),
        ),
        (
            "ends_with",
            schema[0],
            "foo",
            True,
            test_df["a"].str.endswith("foo"),
        ),
        (
            "regex_match",
            schema[0],
            "f[o]+",
            False,
            test_df["a"].str.match("f[o]+", case=False),
        ),
        (
            "regex_match",
            schema[0],
            "f[o]+[^o]*",
            True,
            test_df["a"].str.match("f[o]+[^o]*", case=True),
        ),
    ]

    for search_type, column_schema, term, cs, mask in cases:
        search_filter = _search_filter(
            column_schema,
            term,
            case_sensitive=cs,
            search_type=search_type,
        )

        mask[mask.isna()] = False
        expected_df = test_df[mask.astype(bool)]
        dxf.check_conversion_case(
            test_df,
            expected_df,
            row_filters=[search_filter],
            code_syntax_name="pandas",
        )


def test_convert_pandas_filter_between(dxf: DataExplorerConvertFixture):
    test_df = SIMPLE_PANDAS_DF
    schema = dxf.get_schema("simple")

    cases = [
        (schema[0], 2, 4),  # a column
        (schema[0], 0, 2),  # d column
    ]

    for column_schema, left_value, right_value in cases:
        col = test_df.iloc[:, column_schema["column_index"]]

        ex_between = test_df[(col >= left_value) & (col <= right_value)]
        ex_not_between = test_df[(col < left_value) | (col > right_value)]

        dxf.check_conversion_case(
            test_df,
            ex_between,
            row_filters=[_between_filter(column_schema, str(left_value), str(right_value))],
            code_syntax_name="pandas",
        )
        dxf.check_conversion_case(
            test_df,
            ex_not_between,
            row_filters=[_not_between_filter(column_schema, str(left_value), str(right_value))],
            code_syntax_name="pandas",
        )


def test_convert_pandas_filter_compare(dxf: DataExplorerConvertFixture):
    # Just use the 'a' column to smoke test comparison filters on
    # integers
    test_df = SIMPLE_PANDAS_DF
    column = "a"
    schema = dxf.get_schema("simple")

    for op, op_func in COMPARE_OPS.items():
        filt = _compare_filter(schema[0], op, 3)
        expected_df = test_df[op_func(test_df[column], 3)]
        dxf.check_conversion_case(
            test_df, expected_df, row_filters=[filt], code_syntax_name="pandas"
        )


def test_convert_pandas_filter_datetimetz(dxf: DataExplorerConvertFixture):
    tz = pytz.timezone("US/Eastern")

    test_df = pd.DataFrame(
        {
            "date": pd.date_range("2000-01-01", periods=5, tz="US/Eastern"),
        }
    )
    dxf.register_table("dtz", test_df)
    schema = dxf.get_schema("dtz")

    val = tz.localize(datetime.datetime(2000, 1, 3))  # noqa: DTZ001

    for op, op_func in COMPARE_OPS.items():
        filt = _compare_filter(schema[0], op, "2000-01-03")
        expected_df = test_df[op_func(test_df["date"], val)]
        dxf.check_conversion_case(
            test_df, expected_df, row_filters=[filt], code_syntax_name="pandas"
        )


def test_convert_pandas_sort_and_filter(dxf: DataExplorerConvertFixture):
    # Test that we can convert a sort and filter operation
    test_df = SIMPLE_PANDAS_DF
    schema = dxf.get_schema("simple")
    filt = [_compare_filter(schema[2], FilterComparisonOp.Eq, "foo")]

    sort_keys = [{"column_index": 0, "ascending": True}]

    expected_df = test_df[test_df["c"] == "foo"].sort_values("a", ascending=True)  # type: ignore[call-arg]

    dxf.check_conversion_case(
        test_df,
        expected_df,
        row_filters=filt,
        sort_keys=sort_keys,
        code_syntax_name="pandas",
    )


def test_convert_pandas_series_filter_and_sort(dxf: DataExplorerConvertFixture):
    # Test filtering and sorting on pandas Series
    series_data = [5, 2, 8, 1, 9, 3, 7, 4, 6]
    test_series = pd.Series(series_data, name="values")

    dxf.register_table("test_series", test_series)
    schema = dxf.get_schema("test_series")

    # Test comparison filters on Series
    comparison_cases = [
        (">", 5, test_series[test_series > 5]),
        (">=", 5, test_series[test_series >= 5]),
        ("<", 5, test_series[test_series < 5]),
        ("<=", 5, test_series[test_series <= 5]),
        ("=", 5, test_series[test_series == 5]),
        ("!=", 5, test_series[test_series != 5]),
    ]

    for op, value, expected_series in comparison_cases:
        filt = _compare_filter(schema[0], op, value)
        # check as df to confirm columns
        expected_df = pd.DataFrame({"values": expected_series})
        dxf.check_conversion_case(
            test_series, expected_df, row_filters=[filt], code_syntax_name="pandas"
        )

    # Test between filters
    between_cases = [
        (3, 7, test_series[(test_series >= 3) & (test_series <= 7)]),
        (1, 4, test_series[(test_series >= 1) & (test_series <= 4)]),
    ]

    for left_val, right_val, expected_series in between_cases:
        filt = _between_filter(schema[0], str(left_val), str(right_val))
        expected_df = pd.DataFrame({"values": expected_series})
        dxf.check_conversion_case(
            test_series, expected_df, row_filters=[filt], code_syntax_name="pandas"
        )

        # Test not_between
        not_between_series = test_series[(test_series < left_val) | (test_series > right_val)]
        filt = _not_between_filter(schema[0], str(left_val), str(right_val))
        expected_df = pd.DataFrame({"values": not_between_series})
        dxf.check_conversion_case(
            test_series, expected_df, row_filters=[filt], code_syntax_name="pandas"
        )
    # Test sorting on Series
    sort_cases = [
        (True, test_series.sort_values(ascending=True)),
        (False, test_series.sort_values(ascending=False)),
    ]

    for ascending, expected_series in sort_cases:
        sort_keys = [{"column_index": 0, "ascending": ascending}]
        expected_df = pd.DataFrame({"values": expected_series})
        dxf.check_conversion_case(
            test_series, expected_df, sort_keys=sort_keys, code_syntax_name="pandas"
        )

    # Test combined filter and sort
    filtered_series = test_series.sort_values(ascending=True)
    filtered_series = filtered_series[filtered_series > 3]
    expected_df = pd.DataFrame({"values": filtered_series})

    filt = _compare_filter(schema[0], ">", 3)
    sort_keys = [{"column_index": 0, "ascending": True}]
    dxf.check_conversion_case(
        test_series, expected_df, sort_keys=sort_keys, row_filters=[filt], code_syntax_name="pandas"
    )
