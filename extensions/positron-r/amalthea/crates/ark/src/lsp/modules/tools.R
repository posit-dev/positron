#
# tools.R
#
# Copyright (C) 2022 Posit Software, PBC. All rights reserved.
#
#

`%||%` <- function(x, y) {
    if (length(x) || is.environment(x)) x else y
}

`%??%` <- function(x, y) {
    if (is.null(x)) y else x
}

.ps.binding.replace <- function(symbol, replacement, envir) {

    if (bindingIsLocked(symbol, envir)) {
        unlockBinding(symbol, envir)
        on.exit(lockBinding(symbol, envir), add = TRUE)
    }

    original <- envir[[symbol]]
    assign(symbol, replacement, envir = envir)
    invisible(original)

}
