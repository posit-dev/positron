/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// launch.sh's join_uri_args, run alone in bash: the app arguments Electron on
// Windows would exit on, a URL-like one with others after it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const launch = join(dirname(fileURLToPath(import.meta.url)), '../scripts/launch.sh');
const fn = readFileSync(launch, 'utf8').replace(/\r\n/g, '\n').match(/^join_uri_args\(\) \{\n[\s\S]*?\n\}\n/m)?.[0];

/** EXTRA_ARGS after join_uri_args, or the usage error it raised. */
function join_(windows: boolean, args: string[]): string[] | { usageError: string } {
	assert.ok(fn, 'no join_uri_args() { ... } in launch.sh');
	// usage_error stands in for launch.sh's, which execs dp.ts; NUL-separated so an empty argument survives.
	const script = `set -u\n${fn}usage_error() { printf '%s' "$1"; exit 2; }\nIS_WINDOWS=$1; shift\njoin_uri_args "$@"\nfor a in \${EXTRA_ARGS[@]+"\${EXTRA_ARGS[@]}"}; do printf '%s\\0' "$a"; done`;
	const r = spawnSync('bash', ['-c', script, 'bash', windows ? '1' : '0', ...args], { encoding: 'utf8' });
	if (r.status === 2) { return { usageError: r.stdout }; }
	assert.equal(r.status, 0, r.stderr);
	return r.stdout.split('\0').slice(0, -1);
}

test('--folder-uri and --file-uri reach the app joined to their values', () => {
	for (const windows of [true, false]) {
		assert.deepEqual(join_(windows, ['--folder-uri', 'file:///C:/ws', '--log', 'debug']), ['--folder-uri=file:///C:/ws', '--log', 'debug']);
		assert.deepEqual(join_(windows, ['--log', 'debug', '--file-uri', 'file:///C:/a b.txt']), ['--log', 'debug', '--file-uri=file:///C:/a b.txt']);
	}
});

test('other arguments, and a flag already joined, pass through unchanged', () => {
	const args = ['--folder-uri=file:///private/tmp/ws', '--log', 'debug', 'C:/ws', '--no-sandbox', ''];
	assert.deepEqual(join_(true, args), args);
	assert.deepEqual(join_(false, []), []);
});

test('on Windows, a URL with arguments after it is a usage error', () => {
	const r = join_(true, ['vscode://ext/x', '--log', 'debug']);
	assert.ok(!Array.isArray(r) && r.usageError.startsWith('vscode://ext/x looks like a URL'), JSON.stringify(r));
});

test('a URL last, or before a --, is left as it is; elsewhere one is never refused', () => {
	assert.deepEqual(join_(true, ['--log', 'debug', 'vscode://ext/x']), ['--log', 'debug', 'vscode://ext/x']);
	assert.deepEqual(join_(true, ['vscode://ext/x', '--', '--folder-uri', 'file:///C:/ws']), ['vscode://ext/x', '--', '--folder-uri', 'file:///C:/ws']);
	assert.deepEqual(join_(false, ['vscode://ext/x', '--log', 'debug']), ['vscode://ext/x', '--log', 'debug']);
});

test('a --folder-uri with no value is left for the app to report', () => {
	assert.deepEqual(join_(true, ['--folder-uri']), ['--folder-uri']);
});
