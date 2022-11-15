#
# completions.R
#
# Copyright (C) 2022 by Posit, PBC
#
#

.rs.formalNames <- function(value) {
    names(formals(args(value)))
}

