/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkOrigins, gitIn } from './origin-check.mjs';

/**
 * A repository whose change (base..head) rewrites line 3 of a.ts and deletes
 * its old line 6; b.ts is untouched.
 */
function repo() {
	const dir = mkdtempSync(join(tmpdir(), 'origin-check-'));
	const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
	git('init', '-q');
	git('config', 'user.email', 't@example.com');
	git('config', 'user.name', 't');
	const lines = n => Array.from({ length: n }, (_, i) => `const line${i + 1} = ${i + 1};`);
	writeFileSync(join(dir, 'a.ts'), `${lines(10).join('\n')}\n`);
	writeFileSync(join(dir, 'b.ts'), `${lines(10).join('\n')}\n`);
	git('add', '.');
	git('commit', '-qm', 'base');
	const base = git('rev-parse', 'HEAD');
	const a = lines(10);
	a[2] = 'const line3 = 33;';
	a.splice(5, 1);
	writeFileSync(join(dir, 'a.ts'), `${a.join('\n')}\n`);
	git('commit', '-qam', 'change');
	return { dir, base, head: git('rev-parse', 'HEAD') };
}

const at = (file, start, end = start) => ({ file, start, end });

test('checkOrigins keeps an origin git bears out, with its commits, and drops the rest with why', () => {
	const { dir, base, head } = repo();
	const run = mkdtempSync(join(tmpdir(), 'origin-run-'));
	try {
		const claims = {
			1: ['introduced', { fix: at('a.ts', 3) }],
			2: ['introduced', { fix: at('a.ts', 6) }],
			3: ['introduced', { fix: at('b.ts', 2, 4) }],
			4: ['exposed', { fix: at('b.ts', 2), trigger: at('a.ts', 3) }],
			5: ['exposed', { fix: at('b.ts', 2), trigger: at('a.ts', 9) }],
			6: ['exposed', { fix: at('b.ts', 2) }],
			7: ['inherited', { fix: at('b.ts', 5, 7) }],
			8: ['inherited', { fix: at('a.ts', 2, 4) }],
			9: ['inherited', { fix: null }],
			10: ['inherited', { fix: at('gone.ts', 1) }],
		};
		writeFileSync(join(run, 'report.json'), JSON.stringify({
			findings: [],
			verification: {
				failed: false,
				text: 'x',
				origin: Object.fromEntries(Object.entries(claims).map(([n, [o]]) => [n, o])),
				originEvidence: Object.fromEntries(Object.entries(claims).map(([n, [, e]]) => [n, e])),
			},
		}));
		const lines = checkOrigins(run, { repo: dir, base, head }, { git: gitIn(dir) });
		const v = JSON.parse(execFileSync('cat', [join(run, 'report.json')], { encoding: 'utf8' })).verification;
		assert.deepEqual(v.origin, { 1: 'introduced', 2: 'introduced', 4: 'exposed', 7: 'inherited' });
		assert.deepEqual(v.originEvidence[1], { fix: at('a.ts', 3), commits: [head], deleted: false });
		// Line 6 is where the change deleted a line: blame cannot see it, the diff can.
		assert.deepEqual(v.originEvidence[2], { fix: at('a.ts', 6), commits: [], deleted: true });
		assert.deepEqual(v.originEvidence[4], { fix: at('b.ts', 2), trigger: at('a.ts', 3), commits: [head], deleted: false });
		assert.deepEqual(Object.fromEntries(Object.entries(v.originDropped).map(([n, d]) => [n, d.reason])), {
			3: 'no fix line is in the change',
			5: 'the named changed line is not in the change',
			6: 'exposed with no changed line named',
			8: 'a fix line is in the change, so it is not inherited',
			9: 'no fix location was given',
			10: 'git could not blame gone.ts:1-1 at the head',
		});
		assert.equal(lines.length, 6);
		assert.match(lines[0], /^Finding 3: origin introduced dropped: no fix line is in the change$/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(run, { recursive: true, force: true });
	}
});

test('checkOrigins leaves a report with no origins as it was', () => {
	const run = mkdtempSync(join(tmpdir(), 'origin-run-'));
	try {
		const report = JSON.stringify({ findings: [], verification: { failed: false, text: 'x' } });
		writeFileSync(join(run, 'report.json'), report);
		assert.deepEqual(checkOrigins(run, { repo: '/nowhere', base: 'a', head: 'b' }, { git: () => { throw new Error('not called'); } }), []);
		assert.equal(execFileSync('cat', [join(run, 'report.json')], { encoding: 'utf8' }), report);
	} finally {
		rmSync(run, { recursive: true, force: true });
	}
});
