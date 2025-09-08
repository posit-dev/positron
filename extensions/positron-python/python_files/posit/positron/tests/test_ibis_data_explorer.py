#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""
Test script for Ibis support in the Data Explorer.

Run this script to verify that the Ibis implementation works correctly.
"""

import logging
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

try:
    import ibis
    import numpy as np
    import pandas as pd
except ImportError:
    logger.error(
        "Required dependencies not found. Please install ibis-framework, pandas, and numpy."
    )
    sys.exit(1)

# Import the Data Explorer components
from data_explorer import ConvertToCodeParams, DataExplorerState, IbisView
from utils import BackgroundJobQueue


# Mock the comm module
class MockComm:
    def __init__(self):
        self.messages = []

    def send_event(self, event_type, data):
        self.messages.append((event_type, data))

    def send_result(self, result):
        self.messages.append(("result", result))

    def close(self):
        self.messages.append(("close", None))


def create_test_table():
    """Create a test Ibis table with sample data."""
    # Create a sample pandas DataFrame
    data = {
        "id": range(1, 101),
        "name": [f"User {i}" for i in range(1, 101)],
        "age": np.random.randint(18, 65, size=100),
        "height": np.random.normal(170, 10, size=100),
        "active": np.random.choice([True, False], size=100),
        "created_at": pd.date_range(start="2023-01-01", periods=100, freq="D"),
    }
    df = pd.DataFrame(data)

    # Convert to Ibis table
    ibis_table = ibis.pandas.connect().from_pandas(df)
    return ibis_table


def test_basic_functionality():
    """Test basic functionality of the IbisView implementation."""
    if not HAS_IBIS:
        logger.error("Ibis is not available. Skipping tests.")
        return False

    logger.info("Creating test Ibis table...")
    table = create_test_table()

    logger.info("Creating IbisView instance...")
    comm = MockComm()
    state = DataExplorerState("test_table")
    job_queue = BackgroundJobQueue()
    view = IbisView(table, comm, state, job_queue, sql_string=None)

    # Test schema retrieval
    logger.info("Testing schema retrieval...")
    for i in range(len(table.columns)):
        schema = view._get_single_column_schema(i)
        logger.info(
            f"Column {i}: {schema.column_name}, Type: {schema.type_name}, Display: {schema.type_display}"
        )

    # Test data conversion
    logger.info("Testing data conversion to pandas...")
    df = view._to_pandas()
    logger.info(f"Converted to pandas DataFrame with shape: {df.shape}")

    # Test code generation
    logger.info("Testing code generation...")
    # ConvertToCodeParams imported above

    code_params = ConvertToCodeParams(code_syntax="ibis")
    result = view.convert_to_code(code_params)
    logger.info(f"Generated code: {result}")

    logger.info("All basic tests passed!")
    return True


if __name__ == "__main__":
    logger.info("Testing Ibis support in Data Explorer")

    success = test_basic_functionality()

    if success:
        logger.info("All tests passed!")
        sys.exit(0)
    else:
        logger.error("Tests failed!")
        sys.exit(1)
