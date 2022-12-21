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
