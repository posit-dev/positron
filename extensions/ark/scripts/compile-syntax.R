#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = TRUE)

input  <- args[[1L]]
output <- args[[2L]]

contents <- readLines(input, warn = FALSE)
json <- jsonlite::fromJSON(contents, simplifyVector = FALSE)
vars <- json$variables

for (i in seq_along(names(vars))) {
  pattern <- sprintf("\\{\\{\\s*%s\\s*\\}\\}", names(vars)[[i]])
  replacement <- vars[[i]]
  contents <- gsub(pattern, replacement, contents)
}

writeLines(contents, con = output)

fmt <- "Generated '%s' => '%s'"
msg <- sprintf(fmt, input, output)
writeLines(msg)
