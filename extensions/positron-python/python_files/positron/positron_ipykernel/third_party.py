#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

# Third-party packages that may be available in the user's environment.
# The convention is to use the popular import name for each package followed by an underscore,
# since we may also need to import the actual package inside an `if TYPE_CHECKING` block for type
# checking.


class RestartRequiredError(Exception):
    """Raised when a restart is required to load a third party package."""

    pass


def import_numpy():
    try:
        import numpy
    except ImportError:
        numpy = None
    return numpy


def import_pandas():
    try:
        import pandas
    except ImportError:
        pandas = None
    return pandas


def import_polars():
    try:
        import polars
    except ImportError:
        polars = None
    return polars


def import_torch():
    try:
        import torch  # type: ignore [reportMissingImports] for 3.12
    except ImportError:
        torch = None
    return torch


def import_pyarrow():
    try:
        import pyarrow  # type: ignore [reportMissingImports] for 3.12
    except ImportError:
        pyarrow = None
    return pyarrow


def import_sqlalchemy():
    try:
        import sqlalchemy
    except ImportError:
        sqlalchemy = None
    return sqlalchemy


# Currently, pyright only correctly infers the types below as `Optional` if we set their values
# using function calls.
np_ = import_numpy()
pa_ = import_pyarrow()
pd_ = import_pandas()
pl_ = import_polars()
torch_ = import_torch()
sqlalchemy_ = import_sqlalchemy()


__all__ = ["np_", "pa_", "pd_", "pl_", "torch_", "sqlalchemy_"]
