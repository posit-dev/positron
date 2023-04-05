#
# tools.R
#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#
#

`%||%` <- function(x, y) {
    if (length(x) || is.environment(x)) x else y
}

`%??%` <- function(x, y) {
    if (is.null(x)) y else x
}

ensure_directory <- function(path) {
    dir.create(path, showWarnings = FALSE, recursive = TRUE)
}

ensure_parent_directory <- function(path) {
    ensure_directory(dirname(path))
}
