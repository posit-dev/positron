#
# utils.R
#
# Copyright (C) 2022 Posit Software, PBC. All rights reserved.
#
#

.ps.Call <- function(.NAME, ...) {
    .Call(.NAME, ..., PACKAGE = "(embedding)")
}

.ps.inspect <- function(item) {
    .Internal(inspect(item))
}
