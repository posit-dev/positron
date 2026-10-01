/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./stop-instances.sh', import.meta.url));

function freePort() {
	return new Promise(resolve => {
		const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
	});
}

// A stand-in for the app: answers /json/version, with launch.sh's flags on its command line.
async function fakeApp(dir, udd) {
	const port = await freePort();
	const server = join(dir, 'server.cjs');
	writeFileSync(server, `require('http').createServer((q, r) => r.end('{}')).listen(${port}, '127.0.0.1', () => console.log('up'));`);
	const child = spawn(process.execPath, [server, `--remote-debugging-port=${port}`, `--user-data-dir=${udd}`]);
	await new Promise(resolve => child.stdout.once('data', resolve));
	return { port, child };
}

function run(dir, lines) {
	if (lines) { writeFileSync(join(dir, 'instances.jsonl'), lines.join('\n') + '\n'); }
	const stop = join(dir, 'stop.sh');
	writeFileSync(stop, `#!/usr/bin/env bash\necho "$@" >> "${join(dir, 'stopped')}"\n`);
	chmodSync(stop, 0o755);
	const r = spawnSync('bash', [script, dir], { env: { ...process.env, STOP_SH: stop }, encoding: 'utf8' });
	const stopped = existsSync(join(dir, 'stopped')) ? readFileSync(join(dir, 'stopped'), 'utf8') : '';
	return { r, stopped };
}

const tmp = () => mkdtempSync(join(tmpdir(), 'stop-instances-'));

test('does nothing without an instances file', () => {
	const { r, stopped } = run(tmp());
	assert.equal(r.status, 0, r.stderr);
	assert.equal(stopped, '');
});

test('skips an instance that is already down', async () => {
	const port = await freePort();
	const { r, stopped } = run(tmp(), [JSON.stringify({ cdpPort: port, userDataDir: '/tmp/x/user-data' })]);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(stopped, '');
});

test('stops an instance still up, keeping its run directory', { skip: process.platform === 'win32' }, async () => {
	const dir = tmp();
	const { port, child } = await fakeApp(dir, '/tmp/run 1/user-data');
	try {
		const { r, stopped } = run(dir, ['not json', JSON.stringify({ cdpPort: port, userDataDir: '/tmp/run 1/user-data' })]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(stopped, `--cdp-port ${port}\n`);
		assert.match(r.stdout, new RegExp(`^stopped ${port}$`, 'm'));
	} finally { child.kill(); }
});

test('leaves a port alone when another process owns it', { skip: process.platform === 'win32' }, async () => {
	const dir = tmp();
	const { port, child } = await fakeApp(dir, '/tmp/someone-else/user-data');
	try {
		const { r, stopped } = run(dir, [JSON.stringify({ cdpPort: port, userDataDir: '/tmp/run 1/user-data' })]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(stopped, '');
		assert.match(r.stderr, /not this run's instance; left running/);
	} finally { child.kill(); }
});
