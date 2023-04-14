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

.ps.objectId <- function(object) {
    .ps.Call("ps_object_id", object)
}

.ps.recursiveSearch <- function(object, callback, ...) {

    result <- callback(object, ...)
    if (!is.null(result))
        return(result)

    if (is.recursive(object)) {
        for (i in seq_along(object)) {
            result <- .ps.recursiveSearch(object[[i]], callback, ...)
            if (!is.null(result))
                return(result)
        }
    }

}
