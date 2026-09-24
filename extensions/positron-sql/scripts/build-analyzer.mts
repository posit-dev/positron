/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Builds the SQL analyzer's WebAssembly module from the Rust crate in `sql-analyzer/`.
 *
 * The built module is committed at `resources/sql-analyzer.wasm` rather than produced during
 * `npm install`. It is one platform independent artifact, so unlike a native binary there is
 * nothing per-platform to resolve, and committing it keeps a Rust toolchain off the list of
 * things a Positron build needs. The cost is that it has to be rebuilt deliberately: run
 * `npm run build-analyzer` after changing anything under `sql-analyzer/`, and commit the result.
 *
 * `--check` rebuilds into a temporary file and compares, without touching the committed one, so
 * CI can tell whether the artifact and the crate have drifted apart.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const extensionDir = path.dirname(import.meta.dirname);
const crateDir = path.join(extensionDir, 'sql-analyzer');
const target = 'wasm32-unknown-unknown';
const built = path.join(crateDir, 'target', target, 'release', 'positron_sql_analyzer.wasm');
const committed = path.join(extensionDir, 'resources', 'sql-analyzer.wasm');

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function run(command: string, args: string[]): void {
	const result = spawnSync(command, args, { cwd: crateDir, stdio: 'inherit', shell: false });
	if (result.error) {
		fail(`Could not run ${command}. Install a Rust toolchain from https://rustup.rs to build`
			+ ' the SQL analyzer. The committed resources/sql-analyzer.wasm is what ships, so this'
			+ ' is only needed when changing the crate.');
	}
	if (result.status !== 0) {
		fail(`${command} ${args.join(' ')} failed with status ${result.status}.`);
	}
}

// Added rather than assumed present: it is a one-line no-op once installed, and the error from
// cargo when it is missing names a rustup command rather than what to do about it.
run('rustup', ['target', 'add', target]);
run('cargo', ['build', '--release', '--target', target]);

const bytes = fs.readFileSync(built);

if (process.argv.includes('--check')) {
	const current = fs.existsSync(committed) ? fs.readFileSync(committed) : Buffer.alloc(0);
	if (!current.equals(bytes)) {
		const scratch = path.join(os.tmpdir(), 'sql-analyzer-check.wasm');
		fs.writeFileSync(scratch, bytes);
		fail(`${path.relative(extensionDir, committed)} is out of date with the crate.`
			+ ` Run \`npm run build-analyzer\` in extensions/positron-sql and commit the result.`
			+ ` The freshly built module is at ${scratch} for comparison.`);
	}
	console.log('The committed SQL analyzer matches the crate.');
} else {
	fs.writeFileSync(committed, bytes);
	console.log(`Wrote ${path.relative(extensionDir, committed)} (${(bytes.length / 1024).toFixed(0)} KB).`);
}
