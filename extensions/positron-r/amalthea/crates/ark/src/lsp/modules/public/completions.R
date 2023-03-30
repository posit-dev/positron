#
# completions.R
#
# Copyright (C) 2022 Posit Software, PBC. All rights reserved.
#
#

.ps.formalNames <- function(value) {
    names(formals(args(value)))
}

