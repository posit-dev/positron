#
# help.R
#
# Copyright (C) 2022 by Posit, PBC
#
#

.rs.help.cache <- new.env(parent = emptyenv())

.rs.help.getHelpTextFromFileImpl <- function(helpFile, package = "") {

  rd <- utils:::.getHelpFile(helpFile)

  # If we have pandoc available, then we'll generate HTML help,
  # and then convert that to Markdown.
  #
  # TODO: Sys.which() seems to fail when executed from the kernel?
  # Seems related to the lack of a PATH.
  pandoc <- "/opt/homebrew/bin/pandoc"
  if (file.exists(pandoc)) {

    htmlOutput <- tempfile(pattern = "help-", fileext = ".html")
    on.exit(unlink(htmlOutput), add = TRUE)
    tools::Rd2HTML(rd, out = htmlOutput, package = package)

    markdownOutput <- tempfile(pattern = "help-", fileext = ".md")
    args <- c(shQuote(htmlOutput), "-o", shQuote(markdownOutput))
    output <- system2(pandoc, args, stdout = TRUE, stderr = TRUE)
    cat(output, file = "/tmp/rstudio.log", append = TRUE, sep = "\n")

    if (file.exists(markdownOutput)) {
      contents <- readLines(markdownOutput, warn = FALSE)
      contents <- tail(contents, n = -4L)
      return(list(type = "markdown", value = paste(contents, collapse = "\n")))
    }

  }

  # output <- tempfile(pattern = "help-", fileext = ".txt")
  # on.exit(unlink(output), add = TRUE)

  # tools::Rd2txt(rd, out = output, package = package)

  # contents <- paste(readLines(output, warn = FALSE), collapse = "\n")
  # contents <- gsub("_*\\b_*", "", contents)
  # return(list(type = "text", value = contents))

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

.rs.help.object <- function(topic, source = NULL) {

  helpFiles <- help(topic = (topic))
  if (length(helpFiles)) {
    return(.rs.help.getHelpTextFromFile(helpFiles[[1L]]))
  }

  list(type = "text", value = "")

}

.rs.help.getHtmlHelpContents <- function(topic, package = "") {

  # If a package name is encoded into 'topic', split that here.
  if (grepl(":{2,3}", topic)) {
    parts <- strsplit(topic, ":{2,3}")[[1L]]
    package <- parts[[1L]]
    topic <- parts[[2L]]
  }

  # Get the help file associated with this topic.
  helpFiles <- help(topic = (topic), package = if (nzchar(package)) package)
  if (length(helpFiles) == 0)
    .rs.stopf("No help available for topic '%s'", topic)

  # Get the help documentation.
  helpFile <- helpFiles[[1L]]
  rd <- utils:::.getHelpFile(helpFile)

  # Set 'package' now if it was unknown.
  if (identical(package, "")) {
    pattern <- "/library/([^/]+)/"
    m <- regexec(pattern, helpFile, perl = TRUE)
    matches <- regmatches(helpFile, m)
    if (length(matches) && length(matches[[1L]] == 2L))
      package <- matches[[1L]][[2L]]
  }

  # Convert to html.
  htmlFile <- tempfile(fileext = ".html")
  on.exit(unlink(htmlFile), add = TRUE)
  tools::Rd2HTML(rd, out = htmlFile, package = package)
  contents <- readLines(htmlFile, warn = FALSE)
  paste(contents, collapse = "\n")

}
