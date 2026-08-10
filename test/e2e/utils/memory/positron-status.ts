/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const TABLE_HEADER = /^CPU %\s+Mem MB\s+PID\s+Process$/;

/**
 * Parse the process table out of `positron --status` into a pid-to-name map.
 *
 * Only the names are taken. The Mem MB column is wrong on Linux and macOS
 * (posit-dev/positron#15382, a double percent-to-bytes conversion) and is never
 * read. Tree structure is not taken either: the indentation is applied only to
 * processes Positron could not name, so it is not a depth signal. Structure
 * comes from procfs PPid instead.
 */
export function parseStatusOutput(text: string): Map<number, string> {
	const names = new Map<number, string>();
	const lines = text.split('\n');
	const headerIndex = lines.findIndex(line => TABLE_HEADER.test(line.trim()));
	if (headerIndex === -1) {
		return names;
	}

	for (const line of lines.slice(headerIndex + 1)) {
		if (line.trim() === '') {
			break;
		}
		// Columns are tab separated: load, memory, pid, name.
		const columns = line.split('\t');
		if (columns.length < 4) {
			continue;
		}
		const pid = parseInt(columns[2].trim(), 10);
		if (isNaN(pid)) {
			continue;
		}
		names.set(pid, columns.slice(3).join('\t').trim());
	}
	return names;
}

/**
 * Find the CLI launcher inside a build. Named after product.json
 * applicationName, but some packagings still ship it as `code`, so try both and
 * fail loudly rather than silently returning a path that does not exist.
 */
export function resolveCliPath(buildRoot: string): string {
	const candidates = [join(buildRoot, 'bin', 'positron'), join(buildRoot, 'bin', 'code')];
	const found = candidates.find(candidate => existsSync(candidate));
	if (!found) {
		throw new Error(`No Positron CLI found. Looked for:\n${candidates.join('\n')}`);
	}
	return found;
}

/**
 * Ask a running Positron to describe its own processes. Returns an empty map on
 * any failure: names are an enrichment, and losing them should downgrade the
 * report to `unlabeled` rows rather than fail the run.
 *
 * The CLI spawns a child Electron main process to service `--status`, and that
 * child has two environmental needs of its own. Both failures look identical:
 * exit status 0, no output, nothing on stderr.
 *
 * - It needs a display, so the environment is passed through rather than
 *   scrubbed. Running the app under `xvfb-run` does not cover this call.
 * - It needs `--no-sandbox` in the containers this runs in. The call is
 *   read-only diagnostics, so the sandbox buys nothing here.
 */
export async function readProcessNames(buildRoot: string, userDataDir: string): Promise<Map<number, string>> {
	try {
		const { stdout } = await execFileAsync(
			resolveCliPath(buildRoot),
			['--user-data-dir', userDataDir, '--no-sandbox', '--status'],
			{ timeout: 30_000, maxBuffer: 10 * 1024 * 1024, env: process.env }
		);
		const names = parseStatusOutput(stdout);
		if (names.size === 0) {
			// Silence here means every process lands in `unlabeled`, so say why
			// rather than letting the report quietly degrade.
			console.error(`[memory] --status produced no process table (${stdout.length} bytes): ${stdout.slice(0, 200)}`);
		}
		return names;
	} catch (error) {
		console.error(`[memory] could not read process names: ${error}`);
		return new Map();
	}
}
