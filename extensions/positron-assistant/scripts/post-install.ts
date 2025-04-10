/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';

// Install or update the Copilot Language Server binary
execSync('npm run install-copilot-language-server', {
	stdio: 'inherit'
});
