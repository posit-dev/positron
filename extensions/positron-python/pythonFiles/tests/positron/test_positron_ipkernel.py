import pytest
from IPython.conftest import get_ipython

from positron.positron_ipkernel import ViewerMagic


@pytest.fixture(scope="session")
def get_ip():
    ip = get_ipython()
    ip.register_magics(ViewerMagic)
    return ip


def test_pandas_df_expression(get_ip):
    get_ip.run_cell("import pandas as pd\n" "%view pd.DataFrame({'x': [1,2,3]})")

    assert "view" in get_ip.magics_manager.magics["line"]


def test_pandas_df_var(get_ip):
    get_ip.run_cell(
        "import pandas as pd\n" "a = pd.DataFrame({'x': [1,2,3]})\n" "%view a", store_history=True
    )

    assert "view" in get_ip.magics_manager.magics["line"]
    assert "view" in get_ip.user_ns["In"][1]
    pd = get_ip.user_ns["pd"]
    assert isinstance(get_ip.user_ns["a"], pd.DataFrame)


def test_polars_df_var(get_ip):
    get_ip.run_cell("import polars as pl\n" "a = pl.DataFrame()\n" "%view a", store_history=True)

    assert "view" in get_ip.magics_manager.magics["line"]
    assert "view" in get_ip.user_ns["In"][1]
    pl = get_ip.user_ns["pl"]
    assert isinstance(get_ip.user_ns["a"], pl.DataFrame)


def test_unsupported_type(get_ip):
    with pytest.raises(TypeError):
        get_ip.run_line_magic("view", "12")
