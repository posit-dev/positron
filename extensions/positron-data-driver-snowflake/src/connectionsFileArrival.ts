/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, Stats, unwatchFile, watchFile } from 'fs';

/**
 * How often to check for the file. Matches the interval VS Code's file watcher uses to poll for a
 * watched path that does not exist yet.
 */
const DEFAULT_INTERVAL_MS = 5000;

/**
 * Calls back once when a file that does not exist yet is created, then stops watching.
 *
 * A file system watcher cannot always report this. When the file's directory does not exist either,
 * the watcher waits for the directory, and a file written together with its directory (as Workbench
 * writes $SNOWFLAKE_HOME/connections.toml) can exist before the watcher starts again. Polling the
 * file path itself sees the file arrive however its directory came to be.
 *
 * @param filePath The file to wait for.
 * @param onCreated Called once, when the file exists. Called before this function returns when the
 * file already exists.
 * @param intervalMs How often to check for the file.
 * @returns A disposable that stops watching.
 */
export function watchForFileCreation(
	filePath: string,
	onCreated: () => void,
	intervalMs = DEFAULT_INTERVAL_MS
): { dispose(): void } {
	let watching = true;
	const stop = () => {
		if (watching) {
			watching = false;
			unwatchFile(filePath, listener);
		}
	};
	const listener = (current: Stats) => {
		// fs.watchFile reports a missing file with zeroed stats.
		if (current.ino !== 0 || current.ctimeMs !== 0) {
			stop();
			onCreated();
		}
	};

	// Polling does not keep the extension host alive.
	watchFile(filePath, { persistent: false, interval: intervalMs }, listener);

	// fs.watchFile takes the file's state at its first poll as the starting point and reports only
	// changes from it, so a file created before that poll would never be reported.
	if (existsSync(filePath)) {
		stop();
		onCreated();
	}

	return { dispose: stop };
}
