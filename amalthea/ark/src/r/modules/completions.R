#
# completions.R
#
# Copyright (C) 2022 by RStudio, PBC
#
#

.rs.formalNames <- function(value) {
    names(formals(args(value)))
}

