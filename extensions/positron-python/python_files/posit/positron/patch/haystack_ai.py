"""
Dummy module for haystack_ai to help with pyright imports.
This should never be imported at runtime, as the real module will be used.
This is needed because the package name is haystack-ai (with hyphen) but the
import name can be either haystack_ai or haystack depending on version.
"""

class utils:
    @staticmethod
    def is_in_jupyter() -> bool:
        """Dummy implementation."""
        return False