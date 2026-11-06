/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { secretEnvNames } from '../infra/appEnv';

// Prints the env var names launch.sh must strip from the app, one per line. Never prints values.
for (const name of secretEnvNames(process.env)) {
	console.log(name);
}
