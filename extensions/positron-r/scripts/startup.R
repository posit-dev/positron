# /*---------------------------------------------------------------------------------------------
#  *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#  *--------------------------------------------------------------------------------------------*/

# Tell cli that Positron's console supports colors
options(cli.default_num_colors = 256L)

# Tell cli that Positron's console supports dynamic updates
# TODO: This would be better as `cli.default_dynamic`, but that doesn't exist yet
options(cli.dynamic = TRUE)
