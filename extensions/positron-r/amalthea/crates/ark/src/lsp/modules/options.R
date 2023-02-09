#
# options.R
#
# Copyright (C) 2022 by Posit Software, PBC
#
#

# Enable HTML help
options(help_type = "html")

# Use custom browser implementation
options(browser = function(url) {
    .Call("ps_browse_url", as.character(url), PACKAGE = "(embedding)")
})

# Set cran mirror
local({
    repos <- getOption("repos")
    rstudio_cran <- "https://cran.rstudio.com/"

    if (is.null(repos) || !is.character(repos)) {
        options(repos = c(CRAN = rstudio_cran))
    } else {
        if ("CRAN" %in% names(repos)) {
            if (identical(repos[["CRAN"]], "@CRAN@")) {
                repos[["CRAN"]] <- rstudio_cran
                options(repos = repos)
            }
        } else {
            repos <- c(CRAN = rstudio_cran, repos)
            options(repos = repos)
        }
    }
})
