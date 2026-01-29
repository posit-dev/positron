# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

# Install LanguageServer.jl and dependencies into the extension's depot
#
# This script is run once to set up the language server packages.
# It installs into a dedicated depot to avoid polluting the user's environment.

using Pkg

@info "Installing Julia Language Server packages..."

# Install the required packages
packages = ["LanguageServer", "SymbolServer"]

for pkg in packages
	@info "Installing $pkg..."
	try
		Pkg.add(pkg)
	catch e
		@error "Failed to install $pkg" exception=(e, catch_backtrace())
		exit(1)
	end
end

# Precompile to speed up first start
@info "Precompiling packages..."
try
	Pkg.precompile()
catch e
	@warn "Precompilation had issues" exception=(e, catch_backtrace())
end

@info "Language Server installation complete!"
