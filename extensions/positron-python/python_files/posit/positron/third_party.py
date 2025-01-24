#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

# Third-party packages that may be available in the user's environment.
# The convention is to use the popular import name for each package followed by an underscore,
# since we may also need to import the actual package inside an `if TYPE_CHECKING` block for type
# checking.


def _numpy():
    import numpy

    return numpy


def _pandas():
    import pandas as pd

    return pd


def _polars():
    import polars as pl

    return pl


def _torch():
    import torch

    return torch


def _pyarrow():
    import pyarrow as pa

    return pa


def _sqlalchemy():
    import sqlalchemy

    return sqlalchemy


__all__ = ["_numpy", "_pandas", "_polars", "_torch", "_pyarrow", "_sqlalchemy"]
