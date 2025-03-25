#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""
Patch for haystack-ai library to make it work correctly in Positron notebooks.

The haystack-ai library has a function called is_in_jupyter() that checks if the code
is running in a Jupyter notebook. However, it doesn't recognize Positron's custom IPython shell
(PositronShell) as a Jupyter environment, causing compatibility issues.

This patch overrides the function to always return True when run in Positron.
"""

import importlib.util
import logging

logger = logging.getLogger(__name__)


def _patched_is_in_jupyter() -> bool:
    """Replacement for haystack's is_in_jupyter that always returns True."""
    return True


def patch_haystack_is_in_jupyter() -> None:
    """
    Patch the haystack-ai library's is_in_jupyter function to return True in Positron.

    This ensures haystack-ai correctly identifies Positron notebooks as Jupyter environments.
    """
    try:
        # Try to patch in haystack_ai package (newer version)
        # Both use the same import structure so the patching looks the same for both
        if (
            importlib.util.find_spec("haystack_ai") is not None
            or importlib.util.find_spec("haystack") is not None
        ):
            try:
                import haystack.utils  # type: ignore

                if hasattr(haystack.utils, "is_in_jupyter"):
                    haystack.utils.is_in_jupyter = _patched_is_in_jupyter
                    logger.debug("Patched haystack.utils.is_in_jupyter")
            except ImportError:
                logger.debug("haystack package found but couldn't import haystack.utils")

    except Exception as e:
        logger.debug(f"Failed to patch haystack is_in_jupyter: {e}")
