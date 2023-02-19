#
# completions.R
#
# Copyright (C) 2022 Posit Software, PBC. All rights reserved.
#
#

.rs.formalNames <- function(value) {
    names(formals(args(value)))
}

