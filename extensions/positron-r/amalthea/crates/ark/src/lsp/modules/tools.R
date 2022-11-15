#
# tools.R
#
# Copyright (C) 2022 by Posit, PBC
#
#

.rs.stopf <- function(fmt, ...) {
    message <- sprintf(fmt, ...)
    stop(message)
}
