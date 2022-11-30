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

.ps.writeDeparsedRepresentationToFile <- function(object) {
    contents <- deparse(object)
    tempfile <- tempfile(pattern = "posit-object-", fileext = ".R")
    writeLines(contents, con = tempfile)
    tempfile
}
