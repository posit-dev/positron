#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from unittest.mock import Mock

import pandas as pd
import polars as pl
import pytest
from plotnine import ggplot

from ..access_keys import encode_access_key
from ..formatters.data_explorer_formatter import PositronDataExplorerFormatter
from ..positron_ipkernel import PositronIPyKernel, PositronShell
from ..session_mode import SessionMode


@pytest.fixture
def display_formatter(shell: PositronShell):
    # The kernel (and its data explorer service) is a singleton reused across
    # tests, so clear any tables registered by earlier tests for a clean count.
    data_explorer_service = shell.kernel.data_explorer_service
    data_explorer_service.comms.clear()
    data_explorer_service.table_views.clear()
    data_explorer_service.path_to_comm_ids.clear()
    data_explorer_service.comm_id_to_path.clear()

    return shell.display_formatter


class TestPositronDataExplorerFormatter:
    @pytest.fixture(autouse=True)
    def _setup(self, kernel: PositronIPyKernel, monkeypatch):
        monkeypatch.setattr(kernel, "session_mode", SessionMode.NOTEBOOK)

    def _assert_inline_explorer(
        self, display_formatter, shell, obj, *, rows, columns, source, title, variable_path=None
    ):
        """Format obj and assert the emitted inline data explorer payload."""
        data_dict, meta_dict = display_formatter.format(obj)

        assert PositronDataExplorerFormatter.format_type in data_dict
        data = data_dict[PositronDataExplorerFormatter.format_type]

        assert len(shell.kernel.data_explorer_service.comms) == 1
        comm = next(iter(shell.kernel.data_explorer_service.comms.values()))

        expected = {
            "comm_id": comm.comm_id,
            "shape": {"rows": rows, "columns": columns},
            "source": source,
            "title": title,
            "version": 1,
        }
        # The formatter only emits variable_path when the object resolves to a
        # top-level variable.
        if variable_path is not None:
            expected["variable_path"] = variable_path

        assert data == expected
        assert meta_dict == {}

    def test_pandas_dataframe(self, display_formatter, shell):
        df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})
        self._assert_inline_explorer(
            display_formatter, shell, df, rows=2, columns=2, source="pandas", title="pandas"
        )

    def test_pandas_series(self, display_formatter, shell):
        series = pd.Series([1, 2, 3, 4])
        self._assert_inline_explorer(
            display_formatter, shell, series, rows=4, columns=1, source="pandas", title="pandas"
        )

    def test_polars_dataframe(self, display_formatter, shell):
        df = pl.DataFrame({"a": [1, 2], "b": [3, 4]})
        self._assert_inline_explorer(
            display_formatter, shell, df, rows=2, columns=2, source="polars", title="polars"
        )

    @pytest.mark.xfail(
        reason="PolarsView does not wrap a Series into a DataFrame (unlike PandasView), "
        "so register_table raises and no data explorer MIME is emitted.",
        strict=True,
    )
    def test_polars_series(self, display_formatter, shell):
        series = pl.Series([1, 2, 3, 4])
        self._assert_inline_explorer(
            display_formatter, shell, series, rows=4, columns=1, source="polars", title="polars"
        )

    def test_console_mode_is_noop(self, display_formatter, shell, monkeypatch):
        monkeypatch.setattr(shell.kernel, "session_mode", SessionMode.CONSOLE)
        df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})

        data_dict, meta_dict = display_formatter.format(df)

        assert PositronDataExplorerFormatter.format_type not in data_dict
        assert meta_dict == {}

    def test_resolves_top_level_variable(self, display_formatter, shell):
        """When obj is bound to a top-level variable, use that name as the title."""
        frame = pd.DataFrame({"a": [1, 2]})
        shell.user_ns["my_df"] = frame

        self._assert_inline_explorer(
            display_formatter,
            shell,
            frame,
            rows=2,
            columns=1,
            source="pandas",
            title="my_df",
            variable_path=[encode_access_key("my_df")],
        )

    def test_skips_hidden_variables(self, display_formatter, shell):
        """Hidden variables (like _) should be skipped during resolution."""
        frame = pd.DataFrame({"a": [1, 2]})
        shell.user_ns["_"] = frame
        shell.user_ns_hidden["_"] = frame

        self._assert_inline_explorer(
            display_formatter,
            shell,
            frame,
            rows=2,
            columns=1,
            source="pandas",
            title="pandas",
        )

    def test_resolves_first_non_hidden_match(self, display_formatter, shell):
        """When multiple variables point to the same object, use the first non-hidden one."""
        frame = pd.DataFrame({"a": [1, 2]})
        shell.user_ns["first_df"] = frame
        shell.user_ns["second_df"] = frame

        self._assert_inline_explorer(
            display_formatter,
            shell,
            frame,
            rows=2,
            columns=1,
            source="pandas",
            title="first_df",
            variable_path=[encode_access_key("first_df")],
        )


class TestPositronPlotnineFormatter:
    def test_ggplot_is_drawn(self, display_formatter):
        plot = ggplot()
        plot.draw = Mock()

        data_dict, meta_dict = display_formatter.format(plot)

        # The plot renders via its draw() side effect and claims the display,
        # so format() short-circuits with empty mime bundles.
        plot.draw.assert_called_once_with(show=True)
        assert data_dict == {}
        assert meta_dict == {}

    def test_non_ggplot_is_not_intercepted(self, display_formatter):
        data_dict, meta_dict = display_formatter.format(42)

        # Non-plotnine objects fall through to the standard formatters.
        assert data_dict["text/plain"] == "42"
        assert meta_dict == {}
