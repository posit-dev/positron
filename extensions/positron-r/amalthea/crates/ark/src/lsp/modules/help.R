#
# help.R
#
# Copyright (C) 2022 by Posit, PBC
#
#

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
    return(NULL)

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
