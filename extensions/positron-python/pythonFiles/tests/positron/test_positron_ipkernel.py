import sys

import comm
import pytest
from IPython.conftest import get_ipython

from positron.positron_ipkernel import PositronIPyKernel, ViewerMagic

from .conftest import DummyComm


@pytest.fixture(scope="function")
def shell():
    shell = get_ipython()
    shell.register_magics(ViewerMagic)

    yield shell

    # Reset the namespace so we don't interface with other tests (e.g. environment updates).
    shell.reset()


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


def test_comm_open(kernel: PositronIPyKernel) -> None:
    env_service = kernel.env_service

    # Double-check that comm is not yet open
    assert env_service.env_comm is None

    # Open a comm
    env_comm: DummyComm = comm.create_comm("positron.environment")  # type: ignore
    open_msg = {}
    env_service.on_comm_open(env_comm, open_msg)

    # Check that the comm_open and (empty) list messages were sent
    assert env_comm.messages == [
        {
            "data": {},
            "metadata": None,
            "buffers": None,
            "target_name": "positron.environment",
            "target_module": None,
            "msg_type": "comm_open",
        },
        {
            "data": {
                "msg_type": "list",
                "variables": [],
                "length": 0,
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        },
    ]


def test_numpy_assign_and_update(kernel: PositronIPyKernel) -> None:
    env_comm: DummyComm = kernel.env_service.env_comm  # type: ignore

    kernel.shell.run_cell(
        """import numpy as np
x = np.array(3, dtype=np.int64)"""
    )

    assert env_comm.messages[-1] == {
        "data": {
            "msg_type": "update",
            "assigned": [
                {
                    "display_name": "x",
                    "display_value": "3",
                    "kind": "number",
                    "display_type": "numpy.int64",
                    "type_info": "numpy.ndarray",
                    "access_key": "x",
                    "length": 0,
                    "size": 104,
                    "has_children": False,
                    "has_viewer": False,
                    "is_truncated": True,
                }
            ],
            "removed": set(),
        },
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }

    kernel.shell.run_cell("x = np.array([3], dtype=np.int64)")

    assert env_comm.messages[-1] == {
        "data": {
            "msg_type": "update",
            "assigned": [
                {
                    "display_name": "x",
                    "display_value": "[3]",
                    "kind": "collection",
                    "display_type": "numpy.int64 (1)",
                    "type_info": "numpy.ndarray",
                    "access_key": "x",
                    "length": 1,
                    "size": 120,
                    "has_children": True,
                    "has_viewer": False,
                    "is_truncated": True,
                }
            ],
            "removed": set(),
        },
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }

    kernel.shell.run_cell("x = np.array([[3]], dtype=np.int64)")

    assert env_comm.messages[-1] == {
        "data": {
            "msg_type": "update",
            "assigned": [
                {
                    "display_name": "x",
                    "display_value": "[[3]]",
                    "kind": "collection",
                    "display_type": "numpy.int64 (1, 1)",
                    "type_info": "numpy.ndarray",
                    "access_key": "x",
                    "length": 1,
                    "size": 136,
                    "has_children": True,
                    "has_viewer": False,
                    "is_truncated": True,
                }
            ],
            "removed": set(),
        },
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }


def test_torch_assign_and_update(kernel: PositronIPyKernel) -> None:
    env_comm: DummyComm = kernel.env_service.env_comm  # type: ignore

    kernel.shell.run_cell(
        """import torch
x = torch.tensor(3, dtype=torch.int64)"""
    )

    # Not sure why, but tensor size changes in Python 3.11+
    expected_size = 80 if (sys.version_info.major, sys.version_info.minor) >= (3, 11) else 72
    assert env_comm.messages[-1] == {
        "data": {
            "msg_type": "update",
            "assigned": [
                {
                    "display_name": "x",
                    "display_value": "3",
                    "kind": "number",
                    "display_type": "torch.int64",
                    "type_info": "torch.Tensor",
                    "access_key": "x",
                    "length": 0,
                    "size": expected_size,
                    "has_children": False,
                    "has_viewer": False,
                    "is_truncated": True,
                }
            ],
            "removed": set(),
        },
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }

    kernel.shell.run_cell("x = torch.tensor([3], dtype=torch.int64)")

    assert env_comm.messages[-1] == {
        "data": {
            "msg_type": "update",
            "assigned": [
                {
                    "display_name": "x",
                    "display_value": "[3]",
                    "kind": "collection",
                    "display_type": "torch.int64 (1)",
                    "type_info": "torch.Tensor",
                    "access_key": "x",
                    "length": 1,
                    "size": expected_size,
                    "has_children": True,
                    "has_viewer": False,
                    "is_truncated": True,
                }
            ],
            "removed": set(),
        },
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }

    kernel.shell.run_cell("x = torch.tensor([[3]], dtype=torch.int64)")

    assert env_comm.messages[-1] == {
        "data": {
            "msg_type": "update",
            "assigned": [
                {
                    "display_name": "x",
                    "display_value": "[[3]]",
                    "kind": "collection",
                    "display_type": "torch.int64 (1, 1)",
                    "type_info": "torch.Tensor",
                    "access_key": "x",
                    "length": 1,
                    "size": expected_size,
                    "has_children": True,
                    "has_viewer": False,
                    "is_truncated": True,
                }
            ],
            "removed": set(),
        },
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }


def test_shutdown(kernel: PositronIPyKernel) -> None:
    env_service = kernel.env_service

    # Double-check that the comm is not yet closed
    comm = env_service.env_comm
    assert comm is not None
    assert not comm._closed

    env_service.shutdown()

    # Comm is closed and set to None
    assert comm._closed
