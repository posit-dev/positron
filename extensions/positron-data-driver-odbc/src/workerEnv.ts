/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Builds a clean environment for the forked worker process.
 *
 * The worker is forked from the extension host and run as Node via ELECTRON_RUN_AS_NODE, which
 * means it executes the Electron binary. If the extension host's own bootstrap variables are
 * inherited, the child re-runs VS Code's fork bootstrap instead of the worker entry point: in a
 * dev build, `VSCODE_ESM_ENTRYPOINT` causes the child to load
 * `vs/workbench/api/node/extensionHostProcess` (see `src/bootstrap-fork.ts`), so it tries to
 * become a second extension host and hangs forever -- the worker never loads its native binding
 * and never answers a request.
 *
 * Strip those variables before forking so the child boots straight into the worker script. Mirrors
 * positron-data-driver-sqlite's `workerEnv.ts`.
 *
 * Note that the ODBC environment variables (`ODBCSYSINI`, `ODBCINI`, `ODBCINSTINI`) deliberately
 * survive this scrub: the driver manager in the child reads them to find the same configuration
 * the extension host discovered, so the DSN the user picked resolves to the same thing.
 */
export function createWorkerEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env['NODE_OPTIONS'];
	for (const key of Object.keys(env)) {
		if (key.startsWith('VSCODE_') || key.startsWith('ELECTRON_')) {
			delete env[key];
		}
	}
	return { ...env, ELECTRON_RUN_AS_NODE: '1' };
}
