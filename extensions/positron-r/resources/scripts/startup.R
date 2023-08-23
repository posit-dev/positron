# ---------------------------------------------------------------------------------------------
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
# ---------------------------------------------------------------------------------------------

# Tell cli that Positron's console supports colors
# Requires cli >=3.6.1.9000 (https://github.com/r-lib/cli/pull/625)
options(cli.default_num_colors = 256L)

# Tell cli that Positron's console supports dynamic updates
# TODO: This would be better as `cli.default_dynamic`, but that doesn't exist yet
options(cli.dynamic = TRUE)
