#
# options.R
#
# Copyright (C) 2022 Posit Software, PBC. All rights reserved.
#
#

# Enable HTML help
options(help_type = "html")

# Use internal editor
options(editor = function(file, title, ...) {

    # Make sure the requested files exist.
    file <- as.character(path.expand(file))
    ensure_parent_directory(file)
    file.create(file[!file.exists(file)])

    # Edit those files.
    .ps.Call("ps_editor", as.character(file), as.character(title))

})

# Use custom browser implementation
options(browser = function(url) {
    .ps.Call("ps_browse_url", as.character(url))
})

# Set up error handlers
options(error = function() {
    .ps.Call("ps_error_handler")
})

# Set up graphics device
options(device = function() {
    .ps.Call("ps_graphics_device")
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
