/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// launch.sh --app: a packaged binary started without a checkout. A stub binary
// records its arguments and answers CDP's /json/version, so no app is needed.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const launch = join(dirname(fileURLToPath(import.meta.url)), '../scripts/launch.sh');
const skip = process.platform === 'win32' ? '--app is not supported on Windows' : false;

let tmp = '';
let stub = '';
let argsFile = '';
let json: { pid: number; cdpPort: number; runDir: string; userDataDir: string; app: string | null } | undefined;
let run: ReturnType<typeof spawnSync> | undefined;

function launchApp(app: string) {
	const seed = join(tmp, 'seed');
	return spawnSync('bash', [launch, '--app', app, '--source-user-data-dir', seed, '--', '--log', 'debug'], {
		cwd: join(tmp, 'not-a-checkout'),
		encoding: 'utf8',
		env: { ...process.env, STUB_ARGS: argsFile, POSITRON_LAUNCH_TMP: join(tmp, 'runs') },
	});
}

before(() => {
	if (skip) { return; }
	tmp = mkdtempSync(join(tmpdir(), 'launch-app-'));
	mkdirSync(join(tmp, 'seed', 'User'), { recursive: true });
	writeFileSync(join(tmp, 'seed', 'User', 'settings.json'), '{}\n');
	mkdirSync(join(tmp, 'not-a-checkout'));
	argsFile = join(tmp, 'args');
	stub = join(tmp, 'Positron');
	writeFileSync(stub, [
		'#!/usr/bin/env bash',
		'printf \'%s\\0\' "$@" > "$STUB_ARGS"',
		'for a in "$@"; do case $a in --remote-debugging-port=*) port=${a#*=};; esac; done',
		'exec node -e \'require("http").createServer((q, r) => r.end(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/x" }))).listen(+process.argv[1], "127.0.0.1")\' "$port"',
		'',
	].join('\n'));
	chmodSync(stub, 0o755);
	run = launchApp(stub);
	json = run.status === 0 ? JSON.parse(String(run.stdout).trim().split('\n').pop()!) : undefined;
});

after(() => {
	if (json?.pid) {
		try { process.kill(json.pid); } catch { /* already gone */ }
	}
	if (tmp) { rmSync(tmp, { recursive: true, force: true }); }
});

test('--app runs the binary without a checkout', { skip }, () => {
	assert.equal(run?.status, 0, String(run?.stderr));
	assert.equal(json?.app, stub);
	assert.equal(typeof json?.cdpPort, 'number');
});

test('--app passes the profile, ports and logsPath', { skip }, () => {
	assert.ok(json, String(run?.stderr));
	const args = readFileSync(argsFile, 'utf8').split('\0');
	assert.ok(args.includes(`--user-data-dir=${json.userDataDir}`), args.join(' '));
	assert.ok(args.includes(`--remote-debugging-port=${json.cdpPort}`), args.join(' '));
	assert.ok(args.includes(`--logsPath=${json.runDir}/logs`), args.join(' '));
	assert.ok(args.includes('--log') && args.includes('debug'), args.join(' '));
});

test('--app skips pre-launch', { skip }, () => {
	assert.ok(json, String(run?.stderr));
	assert.doesNotMatch(readFileSync(join(json.runDir, 'code.log'), 'utf8'), /pre-launch/i);
	assert.doesNotMatch(String(run?.stderr), /pre-launch/i);
});

test('--app with a missing binary is a usage error', { skip }, () => {
	const missing = join(tmp, 'no-such-binary');
	const r = launchApp(missing);
	assert.equal(r.status, 2, String(r.stderr));
	assert.match(String(r.stderr), new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
