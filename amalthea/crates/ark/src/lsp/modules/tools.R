#
# tools.R
#
# Copyright (C) 2022 by RStudio, PBC
#
#

.rs.stopf <- function(fmt, ...) {
    message <- sprintf(fmt, ...)
    stop(message)
}
