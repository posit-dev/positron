import pytest


def test_view_pandas_df_expression(shell):
    shell.run_cell("import pandas as pd\n" "%view pd.DataFrame({'x': [1,2,3]})")

    assert "view" in shell.magics_manager.magics["line"]


def test_view_pandas_df_var(shell):
    shell.run_cell(
        "import pandas as pd\n" "a = pd.DataFrame({'x': [1,2,3]})\n" "%view a", store_history=True
    )

    assert "view" in shell.magics_manager.magics["line"]
    assert "view" in shell.user_ns["In"][1]
    pd = shell.user_ns["pd"]
    assert isinstance(shell.user_ns["a"], pd.DataFrame)


def test_view_polars_df_var(shell):
    shell.run_cell("import polars as pl\n" "a = pl.DataFrame()\n" "%view a", store_history=True)

    assert "view" in shell.magics_manager.magics["line"]
    assert "view" in shell.user_ns["In"][1]
    pl = shell.user_ns["pl"]
    assert isinstance(shell.user_ns["a"], pl.DataFrame)


def test_view_unsupported_type(shell):
    with pytest.raises(TypeError):
        shell.run_line_magic("view", "12")
