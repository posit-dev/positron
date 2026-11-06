/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { secretEnvNames } from '../infra/appEnv';

// Prints the env var names launch.sh must strip from the app, one per line. Never prints values.
// `--keep NAME` (repeatable) leaves NAME out of the list, so it reaches the app.
const args = process.argv.slice(2);
const keep = new Set<string>();
for (let i = 0; i < args.length; i += 2) {
	if (args[i] !== '--keep' || !args[i + 1]) {
		console.error('usage: app-env-unset.ts [--keep NAME]...');
		process.exit(2);
	}
	keep.add(args[i + 1]);
}
for (const name of secretEnvNames(process.env)) {
	if (!keep.has(name)) {
		console.log(name);
	}
}
