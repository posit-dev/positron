#
# completions.R
#
# Copyright (C) 2022 by Posit Software, PBC
#
#

.rs.formalNames <- function(value) {
    names(formals(args(value)))
}

