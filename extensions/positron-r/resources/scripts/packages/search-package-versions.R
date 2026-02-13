# ---------------------------------------------------------------------------------------------
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

local({
	pkg <- %s
	ap <- available.packages()
	current <- if (pkg %in% rownames(ap)) ap[pkg, "Version"] else character(0)
	cat(jsonlite::toJSON(current))
})
