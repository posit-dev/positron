#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from importlib.util import find_spec
from typing import Any, Dict
from unittest.mock import patch

import pytest

from positron.positron_ipkernel import PositronShell

missing_haystack = find_spec("haystack") is None and find_spec("haystack_ai") is None


@pytest.mark.skipif(missing_haystack, reason="haystack is not installed")
def test_haystack_patch_automatically_applied(shell: PositronShell):
    """
    Test that the haystack is_in_jupyter function is automatically patched to return True.

    This test verifies our patch for haystack is automatically applied during runtime startup,
    ensuring that Positron is recognized as a Jupyter environment by haystack.

    The patch should already be applied by the PositronIPyKernel initialization,
    so we just need to check if the functions return True without manually calling the patch.
    """
    # Run a cell to import is_in_jupyter and check if it's already patched
    result = shell.run_cell(
        """
# Import the is_in_jupyter function from haystack_ai and haystack
result = {}

# Try haystack_ai (newer versions)
try:
    from haystack_ai.utils import is_in_jupyter as haystack_ai_is_in_jupyter
    result["has_haystack_ai"] = True
    result["haystack_ai_is_in_jupyter"] = haystack_ai_is_in_jupyter()
except ImportError:
    result["has_haystack_ai"] = False

# Try haystack (older versions or fallback)
try:
    from haystack.utils import is_in_jupyter as haystack_is_in_jupyter
    result["has_haystack"] = True
    result["haystack_is_in_jupyter"] = haystack_is_in_jupyter()
except ImportError:
    result["has_haystack"] = False

if not result.get("has_haystack_ai", False) and not result.get("has_haystack", False):
    # If neither module is available, indicate this in the result
    import sys
    print("Neither haystack_ai nor haystack module found", file=sys.stderr)

result
        """
    )

    # Verify the results
    assert result.success
    patch_result = result.result

    # Ensure patch_result is not None and is a dictionary
    assert patch_result is not None, "Result from cell execution is None"
    result_dict: Dict[str, Any] = patch_result

    # We should have at least one of the modules
    has_haystack_ai = result_dict.get("has_haystack_ai", False)
    has_haystack = result_dict.get("has_haystack", False)
    assert has_haystack_ai or has_haystack, "No haystack modules found"

    # Verify haystack_ai function is already patched if available
    if has_haystack_ai:
        assert result_dict["haystack_ai_is_in_jupyter"] is True, (
            "haystack_ai.utils.is_in_jupyter not automatically patched"
        )

    # Verify haystack function is already patched if available
    if has_haystack:
        assert result_dict["haystack_is_in_jupyter"] is True, (
            "haystack.utils.is_in_jupyter not automatically patched"
        )


@patch("importlib.util.find_spec")
def test_patch_handles_missing_modules(mock_find_spec, shell: PositronShell):
    """
    Test that the patch function handles missing modules gracefully.

    This test mocks importlib.util.find_spec to simulate the absence of both
    haystack and haystack_ai modules, and ensures the patch function handles
    this case without errors when automatically applied during runtime startup.
    """
    # Mock find_spec to return None for both modules
    mock_find_spec.return_value = None

    # Run a simple cell to verify the shell operates normally without haystack
    result = shell.run_cell(
        """
# Verify the shell operates normally without haystack
"Shell running normally"
        """
    )

    # Verify the shell continued to operate normally
    assert result.success
    assert result.result == "Shell running normally"
