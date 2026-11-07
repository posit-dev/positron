/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync } from 'fs';

/**
 * How often to check for the file. Matches the interval VS Code's file watcher uses to poll for a
 * watched path that does not exist yet.
 */
const DEFAULT_INTERVAL_MS = 5000;

/**
 * Calls back once when a file that does not exist yet is created, then stops checking.
 *
 * A file system watcher cannot always report this. When the file's directory does not exist either,
 * the watcher waits for the directory, and a file written together with its directory (as Workbench
 * writes $SNOWFLAKE_HOME/connections.toml, or as `snow connection add` writes
 * ~/.snowflake/connections.toml) can exist before the watcher starts again. Checking the file path
 * itself sees the file arrive however its directory came to be.
 *
 * This checks for the file on a plain interval rather than with fs.watchFile: fs.watchFile takes its
 * first stat as the starting point and reports only changes from it, so a file created before that
 * stat runs is never reported.
 *
 * Checking continues until the file exists or the returned disposable is disposed, with no upper
 * bound: a user may add a connection at any time.
 *
 * @param filePath The file to wait for.
 * @param onCreated Called once, at the first check that finds the file.
 * @param intervalMs How often to check for the file.
 * @returns A disposable that stops checking.
 */
export function watchForFileCreation(
	filePath: string,
	onCreated: () => void,
	intervalMs = DEFAULT_INTERVAL_MS
): { dispose(): void } {
	const timer = setInterval(() => {
		if (existsSync(filePath)) {
			clearInterval(timer);
			onCreated();
		}
	}, intervalMs);

	return { dispose: () => clearInterval(timer) };
}
