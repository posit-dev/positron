# ---------------------------------------------------------------------------------------------
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

local({
	old_opt <- options(pak.no_extra_messages = TRUE)
	on.exit(options(old_opt), add = TRUE)
	pkgs <- pak::lib_status()
	cat(jsonlite::toJSON(data.frame(
		id = paste0(pkgs$package, "-", pkgs$version),
		name = pkgs$package,
		displayName = pkgs$package,
		version = as.character(pkgs$version)
	), auto_unbox = TRUE))
})
