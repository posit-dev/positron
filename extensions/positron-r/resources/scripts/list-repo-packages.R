# ----------------------------------------------------------------------------------------
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ----------------------------------------------------------------------------------------

# Lists the packages available from a running R session's repositories, from a
# separate process, so the session never waits on the network.
#
# Reads the session's configuration (a deparsed list) from stdin and prints the
# name of every package available from its repositories, one per line.

cfg <- eval(parse(file("stdin")))
.libPaths(cfg$lib)
options(cfg$options)
options(repos = cfg$repos)

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

ap <- utils::available.packages(contriburl = utils::contrib.url(repos, type = cfg$type))
cat(unique(rownames(ap)), sep = "\n")
