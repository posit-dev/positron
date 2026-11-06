/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { secretValues } from '../infra/appEnv';
import { scanPaths } from '../infra/secretScan';

// Exit codes: 0 clean, 1 secrets found, 2 error. Prints names only, never values.
async function main(): Promise<number> {
	const paths = process.argv.slice(2);
	if (!process.env.E2E_LEAK_CANARY_KEY) {
		console.error('E2E_LEAK_CANARY_KEY is not set; refusing to scan with nothing to look for.');
		return 2;
	}
	const hits = await scanPaths(paths, secretValues(process.env));
	console.log(`${hits.length} hit(s)`);
	for (const hit of hits) {
		console.log(`${hit.file}  ${hit.name}  ${hit.encoding}`);
	}
	return hits.length > 0 ? 1 : 0;
}

main().then(
	code => {
		process.exitCode = code;
	},
	err => {
		console.error(`secret scan failed: ${err instanceof Error ? err.message : String(err)}`);
		process.exitCode = 2;
	}
);
