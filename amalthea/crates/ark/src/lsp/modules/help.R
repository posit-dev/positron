#
# help.R
#
# Copyright (C) 2022 by RStudio, PBC
#
#

.rs.help.cache <- new.env(parent = emptyenv())

.rs.help.getHelpTextFromFileImpl <- function(helpFile, package = "") {

    rd <- utils:::.getHelpFile(helpFile)

    # If we have pandoc available, then we'll generate HTML help,
    # and then convert that to Markdown.
    pandoc <- Sys.which("/opt/homebrew/bin/pandoc")
    if (nzchar(pandoc)) {

        htmlOutput <- tempfile(pattern = "help-", fileext = ".html")
        on.exit(unlink(htmlOutput), add = TRUE)
        tools::Rd2HTML(rd, out = htmlOutput, package = package)

        markdownOutput <- tempfile(pattern = "help-", fileext = ".md")
        args <- c(shQuote(htmlOutput), "-o", shQuote(markdownOutput))
        system2(pandoc, args, stdout = TRUE, stderr = TRUE)

        if (file.exists(markdownOutput)) {
            contents <- paste(readLines(markdownOutput, warn = FALSE), collapse = "\n")
            writeLines(contents)
            return(list(type = "markdown", value = contents))
        }

    }

    output <- tempfile(pattern = "help-", fileext = ".txt")
    on.exit(unlink(output), add = TRUE)

    tools::Rd2txt(rd, out = output, package = package)

    contents <- paste(readLines(output, warn = FALSE), collapse = "\n")
    contents <- gsub("_*\\b_*", "", contents)
    return(list(type = "text", value = contents))

}

.rs.help.getHelpTextFromFile <- function(helpFile, package = "") {

    if (exists(helpFile, envir = .rs.help.cache))
        return(get(helpFile, envir = .rs.help.cache))

    result <- .rs.help.getHelpTextFromFileImpl(helpFile, package)
    assign(helpFile, result, envir = .rs.help.cache)
    result

}

.rs.help.package <- function(package) {

    # First, check for a help topic called '<package>-package'
    topic <- sprintf("%s-package", package)
    helpFiles <- help(topic = (topic), package = (package))
    if (length(helpFiles)) {
        return(.rs.help.getHelpTextFromFile(helpFiles[[1L]]))
    }

    # Otherwise, generate a simple piece of help based on the package's DESCRIPTION file
    # TODO: NYI
    list(type = "text", value = "")

}
