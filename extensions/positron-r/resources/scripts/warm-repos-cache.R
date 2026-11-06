# ----------------------------------------------------------------------------------------
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ----------------------------------------------------------------------------------------

# Warms a running R session's available.packages() cache from a separate
# process, so the session never waits on the network.
#
# Reads the session's configuration (a deparsed list) from stdin. For each
# repository whose cached index is missing or stale, downloads the index and
# moves it into the session's cache directory under the name
# available.packages() looks for. Prints the contrib URL of every repository
# whose index is ready, one per line.

cfg <- eval(parse(file("stdin")))
.libPaths(cfg$lib)
options(cfg$options)
options(repos = cfg$repos)

# Cache downloads in this process's tempdir; they are moved to the session below.
Sys.setenv(R_PACKAGES_CACHE_USER_DIR = "FALSE")

repos <- cfg$repos
if (isTRUE(cfg$pak)) {
  # pak installs from these repos, which add Bioconductor to the configured ones.
  repos <- tryCatch(
    {
      r <- pak::repo_get()
      stats::setNames(r$url, r$name)
    },
    error = function(e) repos
  )
}
repos <- repos[repos != "@CRAN@"]

for (url in utils::contrib.url(repos, type = cfg$type)) {
  # Local repositories are read directly and never cached.
  if (startsWith(url, "file:")) {
    cat(url, "\n", sep = "")
    next
  }
  name <- paste0("repos_", utils::URLencode(url, TRUE), ".rds")
  dest <- file.path(cfg$cache_dir, name)
  age <- difftime(Sys.time(), file.mtime(dest), units = "secs")
  if (!isTRUE(age < cfg$max_age)) {
    try(silent = TRUE, {
      utils::available.packages(contriburl = url, filters = list())
      tmp <- tempfile(tmpdir = cfg$cache_dir)
      if (file.copy(file.path(tempdir(), name), tmp)) {
        file.rename(tmp, dest)
      }
      unlink(tmp)
    })
  }
  if (file.exists(dest)) {
    cat(url, "\n", sep = "")
  }
}
