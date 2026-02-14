# ---------------------------------------------------------------------------------------------
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

local({
	old_opt <- options(pak.no_extra_messages = TRUE)
	on.exit(options(old_opt), add = TRUE)
	outdated <- old.packages()[, "Package"]
	if (length(outdated) > 0) pak::pkg_install(outdated, ask = FALSE)
})
