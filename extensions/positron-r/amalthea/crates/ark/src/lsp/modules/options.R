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
    repos = getOption("repos")

    if (is.null(repos) || identical(repos, "@CRAN@")) {
        options(repos = c(CRAN = "https://cran.rstudio.com/"))
    }
})
