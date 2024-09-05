#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#


def _positron_no_access(filename: str):
    return True


# never allow bokeh to write files in the positron-python extension
# see https://github.com/posit-dev/positron/issues/4397
def patch_bokeh_no_access():
    try:
        from bokeh.io import util

        util._no_access = _positron_no_access
    except ImportError:
        pass
