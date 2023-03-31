#
# completions.R
#
# Copyright (C) 2022 Posit Software, PBC. All rights reserved.
#
#

.ps.completions.customCompletionHandlers <- new.env(parent = emptyenv())

.ps.completions.registerCustomCompletionHandler <- function(package, name, argument, callback) {

    allNames <- c(
        name,
        paste(package, name, sep = "::"),
        paste(package, name, sep = ":::")
    )

    for (name in allNames) {
        spec <- paste(name, argument)
        .ps.completions.customCompletionHandlers[[spec]] <- callback
    }

}

.ps.completions.createCustomCompletions <- function(values, kind = "unknown") {
    list(values, kind)
}

# TODO: .packages() can be slow on networked drives; consider using an indexer to build
# a list of installed packages, similar to RStudio.
.ps.completions.registerCustomCompletionHandler("base", "library", "package", function() {
    .ps.completions.createCustomCompletions(
        values = .packages(TRUE),
        kind = "package"
    )
})

.ps.completions.registerCustomCompletionHandler("base", "options", "...", function() {
    .ps.completions.createCustomCompletions(
        values = names(options()),
        kind = "options"
    )
})

.ps.completions.registerCustomCompletionHandler("base", "Sys.getenv", "x", function() {
    .ps.completions.createCustomCompletions(
        values = names(Sys.getenv()),
        kind = "unknown"
    )
})

.ps.completions.registerCustomCompletionHandler("base", "Sys.setenv", "...", function() {
    .ps.completions.createCustomCompletions(
        values = names(Sys.getenv()),
        kind = "unknown"
    )
})

.ps.completions.getCustomCallCompletions <- function(name, argument) {

    # if this is a qualified name, make sure the package is loaded
    index <- regexpr(name, "::", fixed = TRUE)
    if (as.integer(index) != -1L) {
        package <- substring(name, 1L, index - 1L)
        if (!package %in% loadedNamespaces())
            return(list())
    }

    spec <- paste(name, argument)
    handler <- .ps.completions.customCompletionHandlers[[spec]]
    print(handler)
    if (is.function(handler))
        return(handler())

}

.ps.completions.formalNames <- function(value) {
    names(formals(args(value)))
}
