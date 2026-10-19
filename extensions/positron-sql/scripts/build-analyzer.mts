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
 * Alongside the module it writes `sql-analyzer/wasm-fingerprint.txt`: a hash of the inputs the
 * module was built from, and a hash of the module itself. `--check` recomputes both without
 * building, so CI can tell whether the crate changed without a rebuild, or whether the module
 * changed without its crate (a merge that took one side's module and the other's sources).
 *
 * It fingerprints the inputs rather than rebuilding and comparing bytes because the bytes are
 * not the same across hosts: the same crate built with the same pinned rustc on macOS and on
 * Linux gives different modules, since cargo's per-crate hashes differ between them and those
 * shift the code layout. The fingerprint is host independent. What it does not prove is that the
 * committed module was built from the committed inputs -- only that nobody changed one without
 * running this script to update the other.
 */

import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const extensionDir = path.dirname(import.meta.dirname);
const crateDir = path.join(extensionDir, 'sql-analyzer');
const target = 'wasm32-unknown-unknown';
const built = path.join(crateDir, 'target', target, 'release', 'positron_sql_analyzer.wasm');
const committed = path.join(extensionDir, 'resources', 'sql-analyzer.wasm');
const fingerprintFile = path.join(crateDir, 'wasm-fingerprint.txt');

/**
 * Everything that decides the module's bytes, relative to the extension directory. The crate's
 * tests are left out, since they do not change what is built; this script is in, since it sets
 * the build flags.
 */
const inputs = [
	'sql-analyzer/src',
	'sql-analyzer/Cargo.toml',
	'sql-analyzer/Cargo.lock',
	'sql-analyzer/rust-toolchain.toml',
	'scripts/build-analyzer.mts',
];

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): void {
	const result = spawnSync(command, args, { cwd: crateDir, stdio: 'inherit', shell: false, env });
	if (result.error) {
		fail(`Could not run ${command}. Install a Rust toolchain from https://rustup.rs to build`
			+ ' the SQL analyzer. The committed resources/sql-analyzer.wasm is what ships, so this'
			+ ' is only needed when changing the crate.');
	}
	if (result.status !== 0) {
		fail(`${command} ${args.join(' ')} failed with status ${result.status}.`);
	}
}

/** The output of a command, run in the given directory. */
function output(command: string, args: string[], cwd: string, input?: string): string {
	const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, input });
	if (result.status !== 0) {
		fail(`${command} ${args.join(' ')} failed with status ${result.status}.${result.stderr ? `\n${result.stderr}` : ''}`);
	}
	return result.stdout.trim();
}

/**
 * A hash of the input files as they are in the working tree, including ones not yet committed.
 *
 * Each file is hashed the way git would store it, which applies the repository's line ending
 * normalisation: a Windows checkout with CRLF endings gets the same fingerprint as any other.
 */
function hashInputs(): string {
	const files = output('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...inputs], extensionDir)
		.split('\n')
		.filter(file => file && fs.existsSync(path.join(extensionDir, file)))
		.sort();
	// Absolute, because `--stdin-paths` does not resolve relative paths against the working directory.
	const absolute = files.map(file => path.join(extensionDir, file));
	const blobs = output('git', ['hash-object', '--stdin-paths'], extensionDir, absolute.join('\n')).split('\n');
	const hash = crypto.createHash('sha256');
	files.forEach((file, index) => hash.update(`${blobs[index]} ${file}\n`));
	return hash.digest('hex');
}

function hashFile(file: string): string {
	return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fingerprint(): string {
	return `inputs ${hashInputs()}\nwasm ${hashFile(committed)}\n`;
}

if (process.argv.includes('--check')) {
	const recorded = fs.existsSync(fingerprintFile) ? fs.readFileSync(fingerprintFile, 'utf8') : '';
	if (recorded !== fingerprint()) {
		fail(`${path.relative(extensionDir, committed)} is out of date with the crate, or was changed`
			+ ` without it. Run \`npm run build-analyzer\` in extensions/positron-sql and commit the`
			+ ` module and ${path.relative(extensionDir, fingerprintFile)}.`);
	}
	console.log('The committed SQL analyzer matches the crate.');
	process.exit(0);
}

// Added rather than assumed present: it is a one-line no-op once installed, and the error from
// cargo when it is missing names a rustup command rather than what to do about it.
run('rustup', ['target', 'add', target]);

// Panic messages embed the source path of the code that panicked, and for dependencies and the
// standard library that path is absolute: under this machine's cargo home, and (when rust-src is
// installed) under its rustup toolchain. Remapping both to fixed prefixes keeps home directories
// out of the shipped artifact, and keeps the module the same between machines on the same OS.
// The standard library is mapped to where rustc says it was built, which is what a toolchain
// without rust-src reports already. Both commands run in the crate directory, so they answer for
// the toolchain it pins.
const sysroot = output('rustc', ['--print', 'sysroot'], crateDir);
const commitHash = /^commit-hash: (?<hash>\S+)$/m.exec(output('rustc', ['-vV'], crateDir))?.groups?.hash;
if (!commitHash) {
	fail('Could not read the commit hash from `rustc -vV`.');
}
const cargoHome = process.env.CARGO_HOME ?? path.join(os.homedir(), '.cargo');
const rustflags = [
	`--remap-path-prefix=${path.join(sysroot, 'lib', 'rustlib', 'src', 'rust')}=/rustc/${commitHash}`,
	`--remap-path-prefix=${cargoHome}=/cargo`,
];
// The encoded form separates flags with 0x1f rather than spaces, so paths with spaces survive.
run('cargo', ['build', '--release', '--target', target], {
	...process.env,
	CARGO_ENCODED_RUSTFLAGS: rustflags.join('\x1f'),
});

const bytes = fs.readFileSync(built);
fs.writeFileSync(committed, bytes);
fs.writeFileSync(fingerprintFile, fingerprint());
console.log(`Wrote ${path.relative(extensionDir, committed)} (${(bytes.length / 1024).toFixed(0)} KB)`
	+ ` and ${path.relative(extensionDir, fingerprintFile)}.`);
