#
# options.R
#
# Copyright (C) 2022 by Posit, PBC
#
#

options(browser = function(url) {
    .Call("rs_browseUrl", package = "(embedding)")
})
