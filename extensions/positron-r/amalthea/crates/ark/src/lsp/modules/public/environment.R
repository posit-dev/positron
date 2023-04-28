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

.ps.environment.clipboardFormatDataFrame <- function(x) {
    con <- textConnection(NULL, open = "w")
    on.exit(close(con))

    write.table(x, sep = "\t", file = con, col.names = NA)

    paste(textConnectionValue(con), collapse = "\n")
}
