/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./publish.sh', import.meta.url));
const SECRET = 'sk-test-not-a-real-key-1234';

// A copy of the logs-run fixture, with a secret in a log, a leftover local page,
// and the files CI keeps out. A stub aws fails sts when told to, and on s3 cp
// copies what it was given.
function fixture({ signedIn = true, page = true, report = true, missingLog = false, leakShot = false, env = {}, write = {} } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'publish-'));
	const run = join(dir, 'run');
	cpSync(fileURLToPath(new URL('./fixtures/logs-run/', import.meta.url)), run, { recursive: true });
	mkdirSync(join(run, 'logs/all/9222'), { recursive: true });
	mkdirSync(join(run, 'shots'));
	if (page) {
		writeFileSync(join(run, 'index.html'), '<p>local page</p>');
	}
	if (!report) {
		rmSync(join(run, 'report.md'));
	}
	for (const [path, text] of Object.entries(write)) {
		writeFileSync(join(run, path), text);
	}
	if (missingLog) {
		rmSync(join(run, 'logs/44987-app.log'));
	}
	writeFileSync(join(run, 'actions.log'), 'actions\n');
	writeFileSync(join(run, 'instances.jsonl'), '{"cdpPort":9222}\n');
	writeFileSync(join(run, 'logs/all/9222/renderer.log'), 'raw\n');
	writeFileSync(join(run, 'logs/9222-renderer.log'), `curated ${SECRET}\n`);
	// A real image: the upload stops on a shot the scan cannot read.
	cpSync(fileURLToPath(new URL('./fixtures/shots/clean.png', import.meta.url)), join(run, 'shots/S01-01.png'));
	if (leakShot) {
		cpSync(fileURLToPath(new URL(`./fixtures/shots/${leakShot}`, import.meta.url)), join(run, `shots/S02-01${leakShot.slice(leakShot.lastIndexOf('.'))}`));
	}
	const out = join(dir, 'uploaded');
	const aws = join(dir, 'aws');
	writeFileSync(aws, [
		'#!/usr/bin/env bash',
		`if [ "$1" = sts ]; then exit ${signedIn ? 0 : 255}; fi`,
		`echo "$4" > '${join(dir, 'dest')}'`,
		`cp -a "\${3%/.}" '${out}'`,
	].join('\n'));
	chmodSync(aws, 0o755);
	const r = spawnSync('bash', [script, run], { env: { ...process.env, AWS_CLI: aws, FAKE_API_KEY: SECRET, ...env }, encoding: 'utf8' });
	return { r, run, out, dest: () => readFileSync(join(dir, 'dest'), 'utf8').trim() };
}

test('uploads a redacted copy, rendered for its URL, without actions.log, instances.jsonl or the raw log tree', () => {
	const { r, run, out, dest } = fixture();
	assert.equal(r.status, 0, r.stderr);
	assert.match(dest(), /^s3:\/\/positron-test-reports\/exploratory-report-local-\d{8}-\d{6}-[0-9a-f]{8}$/);
	const url = `https://d38p2avprg8il3.cloudfront.net/${dest().replace('s3://positron-test-reports/', '')}`;
	assert.equal(r.stdout.trim().split('\n').at(-1), `${url}/index.html`);
	// The uploaded page links its issues back to itself; the local one is left alone.
	assert.ok(readFileSync(join(out, 'index.html'), 'utf8').includes(encodeURIComponent(`(${url}/index.html#f1)`)));
	assert.equal(readFileSync(join(run, 'index.html'), 'utf8'), '<p>local page</p>');
	// So does its feedback: only a published page asks for it.
	assert.ok(readFileSync(join(out, 'index.html'), 'utf8').includes(`entry.1746253506=${encodeURIComponent(`${url}/index.html#f1`)}&amp;`));
	assert.equal(readFileSync(join(out, 'logs/9222-renderer.log'), 'utf8'), 'curated [REDACTED]\n');
	assert.ok(existsSync(join(out, 'shots/S01-01.png')));
	assert.ok(!existsSync(join(out, 'actions.log')));
	assert.ok(!existsSync(join(out, 'instances.jsonl')));
	assert.ok(!existsSync(join(out, 'logs/all')));
	// Names only, and the run directory itself is untouched.
	assert.match(r.stdout, /^Redacting FAKE_API_KEY from logs\/9222-renderer\.log$/m);
	assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET));
	assert.match(readFileSync(join(run, 'logs/9222-renderer.log'), 'utf8'), new RegExp(SECRET));
	assert.ok(existsSync(join(run, 'actions.log')));
});

test('refuses without AWS credentials, and says how to sign in', () => {
	const { r, out } = fixture({ signedIn: false });
	assert.equal(r.status, 1);
	assert.match(r.stderr, /aws sso login/);
	assert.ok(!existsSync(out));
});

test('publishes a run that was never rendered locally: the page is rendered for its URL anyway', () => {
	const { r, out } = fixture({ page: false });
	assert.equal(r.status, 0, r.stderr);
	assert.ok(existsSync(join(out, 'index.html')));
});

test('refuses a run with no report, before checking credentials', () => {
	const { r, out } = fixture({ report: false });
	assert.equal(r.status, 1);
	assert.match(r.stderr, /no report\.md/);
	assert.ok(!existsSync(out));
});

test('publishes a run with a listed log missing, as a run downloaded from the CDN is, and says which', () => {
	const { r, out } = fixture({ missingLog: true });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /logs\/44987-app\.log/);
	// Freshly rendered, not the local page copied across.
	assert.notEqual(readFileSync(join(out, 'index.html'), 'utf8'), '<p>local page</p>');
});

test('redacts the credentials CI holds under names the pattern misses', () => {
	const env = { SNOWFLAKE_USER: 'snow-user-4242', SNOWFLAKE_ACCOUNT: 'acct-9876.us-east-1', DATABRICKS_WORKSPACE: 'https://dbc-1234.cloud.databricks.com', MS_FOUNDRY_BASE_URL: 'foundry-5678.example.net' };
	const { r, out } = fixture({ env, write: { 'logs/db.log': `${Object.values(env).join('\n')}\n` } });
	assert.equal(r.status, 0, r.stderr);
	assert.equal(readFileSync(join(out, 'logs/db.log'), 'utf8'), '[REDACTED]\n'.repeat(4));
	for (const name of Object.keys(env)) {
		assert.match(r.stdout, new RegExp(`^Redacting ${name} from logs/db\\.log$`, 'm'));
	}
});

// The value leak.png and leak.jpg show; see scan-shots.test.mjs.
const SHOWN = 'exploratoryfixtureQ7mZ2xK9pL4vR8tNw3';

test('paints a credential out of a screenshot and publishes, leaving the local shot as it was', () => {
	const { r, run, out } = fixture({ leakShot: 'leak.png', env: { EXAMPLE_TOKEN: SHOWN } });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /painted over EXAMPLE_TOKEN in shots\/S02-01\.png/);
	assert.notDeepEqual(readFileSync(join(out, 'shots/S02-01.png')), readFileSync(join(run, 'shots/S02-01.png')));
	assert.deepEqual(readFileSync(join(run, 'shots/S02-01.png')), readFileSync(fileURLToPath(new URL('./fixtures/shots/leak.png', import.meta.url))));
	assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SHOWN));
});

test('refuses a run with a screenshot it cannot paint, naming the shot and never the value', () => {
	const { r, out } = fixture({ leakShot: 'leak.jpg', env: { EXAMPLE_TOKEN: SHOWN } });
	assert.equal(r.status, 1);
	assert.match(r.stderr, /shots\/S02-01\.jpg shows EXAMPLE_TOKEN/);
	assert.match(r.stderr, /nothing was uploaded/);
	assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SHOWN));
	assert.ok(!existsSync(out));
});

// redact.sh on its own, as CI runs it.
const redactScript = fileURLToPath(new URL('./redact.sh', import.meta.url));

function redact(args) {
	return spawnSync('bash', [redactScript, ...args], { env: { ...process.env, FAKE_API_KEY: SECRET }, encoding: 'utf8' });
}

test('redacts every directory it is given, naming each file in full and never the value', () => {
	const root = mkdtempSync(join(tmpdir(), 'redact-'));
	const a = join(root, 'a');
	const b = join(root, 'b');
	mkdirSync(a);
	mkdirSync(b);
	writeFileSync(join(a, 'x.log'), `key ${SECRET}\n`);
	writeFileSync(join(b, 'y.log'), `${SECRET}\n`);
	const r = redact(['--remove', a, b, join(root, 'missing')]);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(readFileSync(join(a, 'x.log'), 'utf8'), 'key [REDACTED]\n');
	assert.equal(readFileSync(join(b, 'y.log'), 'utf8'), '[REDACTED]\n');
	assert.match(r.stdout, new RegExp(`^Redacting FAKE_API_KEY from ${join(a, 'x.log')}$`, 'm'));
	assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET));
});

test('fails on a file it cannot redact, naming the file and never the value', () => {
	const dir = mkdtempSync(join(tmpdir(), 'redact-'));
	writeFileSync(join(dir, 'x.log'), `${SECRET}\n`);
	// perl -i writes a new file beside the old one, which a read-only directory refuses.
	chmodSync(dir, 0o555);
	try {
		const r = redact([dir]);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /could not redact FAKE_API_KEY from x\.log/);
		assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET));
	} finally {
		chmodSync(dir, 0o755);
	}
});
