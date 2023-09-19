/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';

// Compile the R kernel
execSync('yarn run install-kernel', {
	stdio: 'inherit'
});
