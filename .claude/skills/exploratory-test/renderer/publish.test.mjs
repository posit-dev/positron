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

const script = fileURLToPath(new URL('./publish.sh', import.meta.url));
const SECRET = 'sk-test-not-a-real-key-1234';

// A stub aws that fails sts when told to, and on s3 cp copies what it was given.
function fixture({ signedIn = true } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'publish-'));
	const run = join(dir, 'run');
	mkdirSync(join(run, 'logs/all/9222'), { recursive: true });
	mkdirSync(join(run, 'shots'));
	writeFileSync(join(run, 'index.html'), `<p>key ${SECRET}</p>`);
	writeFileSync(join(run, 'report.md'), '# report\n');
	writeFileSync(join(run, 'actions.log'), 'actions\n');
	writeFileSync(join(run, 'logs/all/9222/renderer.log'), 'raw\n');
	writeFileSync(join(run, 'logs/9222-renderer.log'), `curated ${SECRET}\n`);
	writeFileSync(join(run, 'shots/S01-01.png'), 'png');
	const out = join(dir, 'uploaded');
	const aws = join(dir, 'aws');
	writeFileSync(aws, [
		'#!/usr/bin/env bash',
		`if [ "$1" = sts ]; then exit ${signedIn ? 0 : 255}; fi`,
		`echo "$4" > '${join(dir, 'dest')}'`,
		`cp -a "\${3%/.}" '${out}'`,
	].join('\n'));
	chmodSync(aws, 0o755);
	const r = spawnSync('bash', [script, run], { env: { ...process.env, AWS_CLI: aws, FAKE_API_KEY: SECRET }, encoding: 'utf8' });
	return { r, run, out, dest: () => readFileSync(join(dir, 'dest'), 'utf8').trim() };
}

test('uploads a redacted copy without actions.log or the raw log tree, and prints its URL', () => {
	const { r, run, out, dest } = fixture();
	assert.equal(r.status, 0, r.stderr);
	assert.match(dest(), /^s3:\/\/positron-test-reports\/exploratory-report-local-\d{8}-\d{6}-[0-9a-f]{8}$/);
	assert.equal(r.stdout.trim().split('\n').at(-1), `https://d38p2avprg8il3.cloudfront.net/${dest().replace('s3://positron-test-reports/', '')}/index.html`);
	assert.equal(readFileSync(join(out, 'index.html'), 'utf8'), '<p>key [REDACTED]</p>');
	assert.equal(readFileSync(join(out, 'logs/9222-renderer.log'), 'utf8'), 'curated [REDACTED]\n');
	assert.ok(existsSync(join(out, 'shots/S01-01.png')));
	assert.ok(!existsSync(join(out, 'actions.log')));
	assert.ok(!existsSync(join(out, 'logs/all')));
	// Names only, and the run directory itself is untouched.
	assert.match(r.stdout, /^Redacting FAKE_API_KEY from index\.html$/m);
	assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET));
	assert.match(readFileSync(join(run, 'index.html'), 'utf8'), new RegExp(SECRET));
	assert.ok(existsSync(join(run, 'actions.log')));
});

test('refuses without AWS credentials, and says how to sign in', () => {
	const { r, out } = fixture({ signedIn: false });
	assert.equal(r.status, 1);
	assert.match(r.stderr, /aws sso login/);
	assert.ok(!existsSync(out));
});
