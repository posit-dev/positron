#
# environment.R
#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#
#
.ps.environment.listDisplayNames <- function(x) {
    names <- names(x)
    if (is.null(names)) {
        paste0("[[", seq_along(x), "]]")
    } else {
        empty <- which(names == "")
        names[empty] <- paste0("[[", empty, "]]")
    }
    names
}

.ps.environment.resolveObjectFromPath <- function(env, path) {
    object <- env

    rx_unnamed <- "^[[][[]([[:digit:]])[]][]]"

    for (p in path) {
        if (grepl(rx_unnamed, p)) {
            index <- as.integer(sub(rx_unnamed, "\\1", p))
            object <- object[[index]]
        } else {
            object <- object[[p]]
        }
    }

    object
}
