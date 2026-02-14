# ---------------------------------------------------------------------------------------------
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

local({
	old_opt <- options(pak.no_extra_messages = TRUE)
	on.exit(options(old_opt), add = TRUE)
	pkgs <- pak::pkg_search(%s, size = 100)
	cat(jsonlite::toJSON(data.frame(
		id = pkgs$package,
		name = pkgs$package,
		displayName = pkgs$package,
		version = "0"
	), auto_unbox = TRUE))
})
