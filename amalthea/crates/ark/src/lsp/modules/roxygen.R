#
# roxygen.R
#
# Copyright (C) 2022 by RStudio, PBC
#
#

.rs.roxygen.tagList <- function() {

    # check for roxygen2 tags to be used
    tagList <- system.file("roxygen2-tags.yml", package = "roxygen2")
    if (file.exists(tagList)) {

    }
    c("@param")
}
