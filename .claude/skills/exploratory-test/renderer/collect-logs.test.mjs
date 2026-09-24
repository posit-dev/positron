/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./collect-logs.sh', import.meta.url));

function fixture({ logsPath = true, consoles = ['Python 3.12.1 Console.log'] } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'collect-logs-'));
	const tree = join(dir, 'state/20260924T100000');
	const sup = join(tree, 'window1/exthost/positron.positron-supervisor');
	mkdirSync(sup, { recursive: true });
	writeFileSync(join(tree, 'window1/renderer.log'), '[info] a\n[error] b\n[error] c\n');
	writeFileSync(join(tree, 'window1/exthost/exthost.log'), '[info] ok\n');
	for (const c of consoles) { writeFileSync(join(sup, c), `${c}\n`); }
	const logFile = join(dir, 'code.log');
	writeFileSync(logFile, logsPath ? `[info] start\n  logsPath: '${tree}',\n` : '[info] start\n');
	const cli = join(dir, 'cli');
	writeFileSync(cli, '#!/usr/bin/env bash\necho "[ERROR] uncaught $1"\n');
	chmodSync(cli, 0o755);
	const run = join(dir, 'run');
	const r = spawnSync('bash', [script, logFile, '9222', 's1', run], { env: { ...process.env, PLAYWRIGHT_CLI: cli }, encoding: 'utf8' });
	return { r, logs: join(run, 'logs') };
}

test('copies the tree and each log, and counts errors in each', () => {
	const { r, logs } = fixture();
	assert.equal(r.status, 0, r.stderr);
	assert.ok(existsSync(join(logs, 'all/9222/window1/renderer.log')));
	assert.equal(readFileSync(join(logs, '9222-console.log'), 'utf8'), '[ERROR] uncaught -s=s1\n');
	assert.ok(existsSync(join(logs, '9222-python-console.log')));
	assert.match(r.stdout, /^logs\/9222-renderer\.log \| 2 \[error\] lines$/m);
	assert.match(r.stdout, /^logs\/9222-exthost\.log \| 0 \[error\] lines$/m);
	assert.match(r.stdout, /^logs\/9222-console\.log \| 1 \[error\] lines$/m);
	assert.match(r.stdout, /^logs\/all\/9222\/ \| full tree$/m);
});

test('two consoles for one language keep their versions', () => {
	const { r, logs } = fixture({ consoles: ['R 4.4.1 Console.log', 'R 4.5.0 Console.log', 'Python 3.12.1 Console.log'] });
	assert.equal(r.status, 0, r.stderr);
	assert.ok(existsSync(join(logs, '9222-r-4.4.1-console.log')));
	assert.ok(existsSync(join(logs, '9222-r-4.5.0-console.log')));
	assert.ok(existsSync(join(logs, '9222-python-console.log')));
});

test('fails loudly without a logsPath: line', () => {
	const { r } = fixture({ logsPath: false });
	assert.equal(r.status, 1);
	assert.match(r.stderr, /relaunch with --log debug/);
});
