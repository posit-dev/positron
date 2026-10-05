/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { candidateBranch, cli, compareUrl, smokeChecksChanged, staleBranches } from './links.ts';

test('candidateBranch', () => {
	assert.equal(candidateBranch(new Date('2026-10-06T03:30:00Z'), '123'), 'automated/drive-positron/2026-10-06-123');
	assert.ok(!candidateBranch(new Date(), '1').startsWith('automated/drive-positron-heal'));
});

test('compareUrl encodes title and body', () => {
	const u = new URL(compareUrl('automated/drive-positron/2026-10-06-1', 'drive-positron: 1 fix', 'a & b\nc', 'https://run'));
	assert.equal(u.pathname, '/posit-dev/positron/compare/main...automated/drive-positron/2026-10-06-1');
	assert.equal(u.searchParams.get('expand'), '1');
	assert.equal(u.searchParams.get('title'), 'drive-positron: 1 fix');
	assert.equal(u.searchParams.get('body'), 'a & b\nc\n\nFull run: https://run');
});

test('compareUrl trims a long body, keeps the run link, never splits an escape', () => {
	const body = 'x\u00e9 '.repeat(5000);
	const url = compareUrl('b', 't', body, 'https://run/1', 2000);
	assert.ok(url.length <= 2000);
	const got = new URL(url).searchParams.get('body')!;
	assert.ok(got.endsWith('(trimmed)\n\nFull run: https://run/1'));
});

test('compareUrl terminates on emoji bodies and never splits a pair', { timeout: 5000 }, () => {
	const body = 'x'.repeat(50) + '\u{1F600}'.repeat(300);
	const url = compareUrl('b', 't', body, 'https://run/1', 500);
	assert.ok(url.length <= 500);
	const got = new URL(url).searchParams.get('body')!;
	assert.equal(decodeURIComponent(url.slice(url.indexOf('body=') + 5)), got);
	assert.ok(got.endsWith('(trimmed)\n\nFull run: https://run/1'));
});

test('staleBranches: older than 14 days by the date in the name, without an open PR', () => {
	const now = new Date('2026-10-30T00:00:00Z');
	const branches = ['automated/drive-positron/2026-10-01-1', 'automated/drive-positron/2026-10-02-2', 'automated/drive-positron/2026-10-20-3', 'automated/drive-positron/odd'];
	assert.deepEqual(staleBranches(branches, ['automated/drive-positron/2026-10-02-2'], now), ['automated/drive-positron/2026-10-01-1']);
});

test('smokeChecksChanged', () => {
	assert.equal(smokeChecksChanged(['.claude/skills/drive-positron/test/smoke.ts']), true);
	assert.equal(smokeChecksChanged(['.claude/skills/drive-positron/scripts/dp-ui.ts']), false);
});

test('cli candidate and usage errors', () => {
	assert.deepEqual(cli(['candidate', '--run-id', '7'], new Date('2026-10-06T00:00:00Z')), { code: 0, out: 'automated/drive-positron/2026-10-06-7' });
	assert.equal(cli([]).code, 2);
	assert.equal(cli(['nope']).code, 2);
	assert.equal(cli(['candidate']).code, 2);
	assert.equal(cli(['candidate', '--run-id']).code, 2);
	assert.equal(cli(['candidate', '--run-id', '7', '--bogus', 'x']).code, 2);
	assert.equal(cli(['compare', '--branch', 'b']).code, 2);
});

test('cli compare and stale read their files', () => {
	const d = mkdtempSync(join(tmpdir(), 'links-'));
	writeFileSync(join(d, 'body'), 'a & b\n');
	const c = cli(['compare', '--branch', 'b', '--title', 't', '--body-file', join(d, 'body'), '--run-url', 'https://run']);
	assert.equal(c.code, 0);
	assert.equal(new URL(c.out).searchParams.get('body'), 'a & b\n\n\nFull run: https://run');
	const old = 'automated/drive-positron/2026-01-01-1';
	const open = 'automated/drive-positron/2026-01-02-2';
	writeFileSync(join(d, 'br'), `${old}\n${open}\nother\n`);
	writeFileSync(join(d, 'op'), `${open}\n`);
	assert.deepEqual(cli(['stale', '--branches', join(d, 'br'), '--open', join(d, 'op')], new Date('2026-10-06T00:00:00Z')), { code: 0, out: old });
	assert.throws(() => cli(['stale', '--branches', join(d, 'missing'), '--open', join(d, 'op')]));
});
