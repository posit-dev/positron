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

import logging
import importlib.util

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
        # Check if haystack_ai is installed
        if importlib.util.find_spec("haystack_ai") is None:
            # Also check for older haystack package
            if importlib.util.find_spec("haystack") is None:
                return

            # Try to patch in older haystack package
            try:
                import haystack.utils

                if hasattr(haystack.utils, "is_in_jupyter"):
                    haystack.utils.is_in_jupyter = _patched_is_in_jupyter
                    logger.debug("Patched haystack.utils.is_in_jupyter")
            except ImportError:
                pass

            return

        # Patch in newer haystack_ai package
        try:
            # Try to import as haystack_ai (which is the import path used in newer versions)
            try:
                import haystack_ai.utils

                if hasattr(haystack_ai.utils, "is_in_jupyter"):
                    haystack_ai.utils.is_in_jupyter = _patched_is_in_jupyter
                    logger.debug("Patched haystack_ai.utils.is_in_jupyter")
            except ImportError:
                # Try fallback to haystack.utils for newer haystack-ai package
                # (sometimes the package is haystack-ai but the import is still haystack)
                import haystack.utils

                if hasattr(haystack.utils, "is_in_jupyter"):
                    haystack.utils.is_in_jupyter = _patched_is_in_jupyter
                    logger.debug(
                        "Patched haystack.utils.is_in_jupyter for haystack-ai package"
                    )
        except ImportError:
            pass

    except Exception as e:
        logger.debug(f"Failed to patch haystack is_in_jupyter: {e}")
