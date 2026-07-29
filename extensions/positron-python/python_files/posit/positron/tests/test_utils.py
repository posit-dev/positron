#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import io

import matplotlib
import matplotlib.pyplot as plt
import pytest
from PIL import Image

from positron.utils import get_qualname, jpeg_pixel_size


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


def test_jpeg_pixel_size() -> None:
    """`jpeg_pixel_size` reads a JPEG's pixel dimensions from its first SOF marker."""
    prev_backend = matplotlib.get_backend()
    matplotlib.use("agg")
    try:
        fig, ax = plt.subplots(figsize=(4, 3), dpi=100)
        ax.plot([0, 1], [0, 1])
        buffer = io.BytesIO()
        fig.savefig(buffer, format="jpeg")
        plt.close(fig)
    finally:
        matplotlib.use(prev_backend)
    data = buffer.getvalue()

    # Cross-check against PIL's own JPEG header parsing rather than hardcoding the
    # expected size, since the encoded size can differ slightly from the figure's
    # requested inch size (dpi rounding).
    expected = Image.open(io.BytesIO(data)).size

    assert jpeg_pixel_size(data) == expected
