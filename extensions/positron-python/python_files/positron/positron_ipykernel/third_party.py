#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

# Third-party packages that may be available in the user's environment.
# The convention is to use the popular import name for each package followed by an underscore,
# since we may also need to import the actual package inside an `if TYPE_CHECKING` block for type
# checking.


def _get_numpy():
    try:
        import numpy
    except ImportError:
        numpy = None
    return numpy


def _get_pandas():
    try:
        import pandas
    except ImportError:
        pandas = None
    return pandas


def _get_polars():
    try:
        import polars
    except ImportError:
        polars = None
    return polars


def _get_torch():
    try:
        import torch  # type: ignore [reportMissingImports] for 3.12
    except ImportError:
        torch = None
    return torch


def _get_pyarrow():
    try:
        import pyarrow  # type: ignore [reportMissingImports] for 3.12
    except ImportError:
        pyarrow = None
    return pyarrow


def _get_sqlalchemy():
    try:
        import sqlalchemy
    except ImportError:
        sqlalchemy = None
    return sqlalchemy


# Currently, pyright only correctly infers the types below as `Optional` if we set their values
# using function calls.
np_ = _get_numpy()
pa_ = _get_pyarrow()
pd_ = _get_pandas()
pl_ = _get_polars()
torch_ = _get_torch()
sqlalchemy_ = _get_sqlalchemy()

__all__ = ["np_", "pa_", "pd_", "pl_", "torch_", "sqlalchemy_"]
