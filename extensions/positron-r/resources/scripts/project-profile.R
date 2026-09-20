# ---------------------------------------------------------------------------------------------
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

# Source `R_PROFILE_USER` from the R parent project and return it to notebook folder.
local({
  profile <- Sys.getenv("POSITRON_R_PROJECT_PROFILE")

  # Unset first: renv's `activate.R` sources `R_PROFILE_USER` again when its
  # autoloader is disabled, and child R processes must not inherit these.
  Sys.unsetenv(c("R_PROFILE_USER", "POSITRON_R_PROJECT_PROFILE"))

  if (!file.exists(profile)) {
    return(invisible())
  }

  done <- FALSE
  on.exit(if (!done) message("Error while sourcing the project R profile '", profile, "'"))
  sys.source(profile, envir = globalenv(), chdir = TRUE)
  done <- TRUE
})
