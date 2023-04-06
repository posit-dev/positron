#
# environment.R
#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#
#
.ps.environment.listDisplayNames <- function(x) {
    names <- names(x)
    if (is.null(names)) {
        names <- paste0("[[", seq_along(x), "]]")
    } else {
        empty <- which(names == "")
        names[empty] <- paste0("[[", empty, "]]")
    }
    names
}
