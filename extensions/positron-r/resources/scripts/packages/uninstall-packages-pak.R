# ---------------------------------------------------------------------------------------------
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

local({
	pkgs <- %s
	pak::pkg_remove(pkgs)
	for (pkg in pkgs) {
		try(unloadNamespace(pkg), silent = TRUE)
	}
})
