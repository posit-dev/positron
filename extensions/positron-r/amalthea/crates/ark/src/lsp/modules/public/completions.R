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

.ps.completions.formalNamesDefault <- function(callable) {

    # NOTE: Some primitive R functions used for control flow
    # are considered functions, but 'args()' returns `NULL`
    # instead of an R function.
    args <- args(callable)
    if (!is.function(args))
        return(character())

    names(formals(args))

}

.ps.completions.formalNamesS3 <- function(generic, object) {

    classes <- c(class(object), "default")
    for (class in classes) {

        # We use 'substitute()' and 'eval()' here just to ensure that
        # the lookup for S3 methods happens in the global environment.
        call <- substitute(
            utils::getS3method(generic, class, optional = TRUE),
            list(generic = generic, class = class)
        )

        method <- eval(call, envir = globalenv())
        if (is.function(method))
            return(.ps.completions.formalNamesDefault(method))

    }

}

.ps.completions.formalNames <- function(callable, object) {

    # If object is NULL, just use the formals from the callable as-is.
    if (is.null(object))
        return(.ps.completions.formalNamesDefault(callable))

    # Otherwise, try and see if there's an S3 method we can use for dispatch.
    generic <- .ps.s3.genericNameFromFunction(callable)
    if (length(generic))
        return(.ps.completions.formalNamesS3(generic, object))

    # Fall back to default implementation.
    .ps.completions.formalNamesDefault(callable)

}
