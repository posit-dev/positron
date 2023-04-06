#
# completions.R
#
# Copyright (C) 2022 Posit Software, PBC. All rights reserved.
#
#

.ps.completions.customCompletionHandlers <- new.env(parent = emptyenv())

.ps.completions.registerCustomCompletionHandler <- function(package,
                                                            name,
                                                            argument,
                                                            callback)
{
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

.ps.completions.createCustomCompletions <- function(values,
                                                    kind = "unknown",
                                                    enquote = FALSE,
                                                    append = "")
{
    list(
        as.character(values),
        as.character(kind),
        as.logical(enquote),
        as.character(append)
    )
}

# TODO: .packages() can be slow on networked drives; consider using an indexer to build
# a list of installed packages, similar to RStudio.
.ps.completions.registerCustomCompletionHandler("base", "library", "package", function(position) {
    .ps.completions.createCustomCompletions(
        values  = .packages(TRUE),
        kind    = "package",
        enquote = FALSE,
        append  = ""
    )
})

.ps.completions.registerCustomCompletionHandler("base", "getOption", "x", function(position) {
    .ps.completions.createCustomCompletions(
        values  = names(options()),
        kind    = "options",
        enquote = TRUE,
        append  = ""
    )
})

.ps.completions.registerCustomCompletionHandler("base", "options", "...", function(position) {

    if (position != "name")
        return(NULL)

    .ps.completions.createCustomCompletions(
        values  = names(options()),
        kind    = "options",
        enquote = FALSE,
        append  = " = "
    )
})

.ps.completions.registerCustomCompletionHandler("base", "Sys.getenv", "x", function(position) {
    .ps.completions.createCustomCompletions(
        values  = names(Sys.getenv()),
        kind    = "unknown",
        enquote = TRUE,
        append  = ""
    )
})

.ps.completions.registerCustomCompletionHandler("base", "Sys.setenv", "...", function(position) {

    if (position != "name")
        return(NULL)

    .ps.completions.createCustomCompletions(
        values = names(Sys.getenv()),
        kind = "unknown",
        enquote = FALSE,
        append = " = "
    )
})

.ps.completions.getCustomCallCompletions <- function(name, argument, position) {

    # If this is a qualified name, make sure the package is loaded.
    index <- regexpr(name, "::", fixed = TRUE)
    if (as.integer(index) != -1L) {
        package <- substring(name, 1L, index - 1L)
        if (!package %in% loadedNamespaces())
            return(NULL)
    }

    # Search for a completion handler for this specification.
    spec <- paste(name, argument)
    handler <- .ps.completions.customCompletionHandlers[[spec]]
    if (is.function(handler))
        return(handler(position))

}

.ps.completions.formalNames <- function(value) {
    names(formals(args(value)))
}
