# ---------------------------------------------------------------------------------------------
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

local({
	query <- tolower(%s)
	ap <- available.packages()
	matches <- ap[grepl(query, tolower(ap[, "Package"]), fixed = TRUE), , drop = FALSE]
	cat(jsonlite::toJSON(data.frame(
		id = matches[, "Package"],
		name = matches[, "Package"],
		displayName = matches[, "Package"],
		version = "0"
	), auto_unbox = TRUE))
})
