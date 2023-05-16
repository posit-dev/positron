#
# data_viewer.R
#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#
#

.ps.view_data_frame <- function(x, title = deparse(substitute(x))) {
    stopifnot(
        is.data.frame(x) || is.matrix(x),
        is.character(title) && length(title) == 1L
    )
    invisible(.ps.Call("ps_view_data_frame", x, title))
}
