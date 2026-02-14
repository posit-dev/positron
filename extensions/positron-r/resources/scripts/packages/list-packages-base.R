# ---------------------------------------------------------------------------------------------
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

local({
	ip <- installed.packages()
	cat(jsonlite::toJSON(data.frame(
		id = paste0(ip[, "Package"], "-", ip[, "Version"]),
		name = ip[, "Package"],
		displayName = ip[, "Package"],
		version = ip[, "Version"]
	), auto_unbox = TRUE))
})
