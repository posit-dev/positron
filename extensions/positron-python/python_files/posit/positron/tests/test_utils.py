#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import pytest

from positron.utils import get_qualname


class BadGetAttrImpl:
    def __getattr__(self, _attribute: str):
        # Wrongly returns an instance of itself instead of raising an AttributeError
        return BadGetAttrImpl()


@pytest.mark.parametrize("value", [BadGetAttrImpl(), BadGetAttrImpl])
def test_get_qualname_handles_bad_class(value) -> None:
    """Test we can handle classes with bad __getattr__ implementations. See issue 6237."""
    qualname = get_qualname(value)

    # qualname should be a valid string and not raise any errors
    assert isinstance(qualname, str), f"Expected string, got {type(qualname)}"
    assert qualname == "positron.tests.test_utils.BadGetAttrImpl"
