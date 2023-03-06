#
# tools.R
#
# Copyright (C) 2022 Posit Software, PBC. All rights reserved.
#
#

.ps.replaceBinding <- function(symbol, replacement, envir) {

    if (bindingIsLocked(symbol, envir)) {
        unlockBinding(symbol, envir)
        on.exit(lockBinding(symbol, envir), add = TRUE)
    }

    original <- envir[[symbol]]
    assign(symbol, replacement, envir = envir)
    invisible(original)

}
