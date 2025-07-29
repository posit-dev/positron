#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#
from typing import List, Optional

from ..data_explorer_comm import (
    BackendState,
    StrictStr,
)
from ..third_party import is_pandas, is_polars


class CodeFragment:
    """Represents a piece of generated code with its dependencies."""

    def __init__(
        self,
        preprocessing: Optional[List[str]] = None,
        method_chain: str = "",
        postprocessing: Optional[List[str]] = None,
    ):
        self.preprocessing = preprocessing or []
        self.method_chain = method_chain
        self.postprocessing = postprocessing or []


class CodeConverter:
    """Base class for generating dataframe code strings."""

    def __init__(self, table, state):
        """
        Initialize the code generator with a default DataFrame variable name.

        Args:
            table_name: Variable name to use for the DataFrame in generated code
            table: DataFrame or Series to generate code for
        """
        self.state: BackendState = state
        self.table_name: str = state.name
        self.table = table

    def convert(self, params) -> List[StrictStr]:
        """Convert operation specification to list of code strings."""
        raise NotImplementedError("Subclasses must implement convert method")
