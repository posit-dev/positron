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
import { changedRanges, fixCommits, fixInChange, renderAccuracy, tally } from './origin-accuracy.mjs';

test('fixCommits reads the commits a fixed row names, and none for any other row', () => {
	const row = (outcome, evidence, decidedBy = 'diff+model') => ({ outcome, evidence, decidedBy });
	assert.deepEqual(fixCommits(row('fixed-in-pr', 'pr a1b2c3d,e4f5a6b: the guard was added')), ['a1b2c3d', 'e4f5a6b']);
	assert.deepEqual(fixCommits(row('fixed-in-pr', 'pr (whole) a1b2c3d: yes')), ['a1b2c3d']);
	assert.deepEqual(fixCommits(row('fixed-later', 'main 1234567: yes')), ['1234567']);
	assert.deepEqual(fixCommits(row('fixed-later', 'issue #12: closed', 'issue-closed')), []);
	assert.deepEqual(fixCommits(row('not-fixed', 'main 1234567: no')), []);
});

test('changedRanges lists the parent lines each file\'s hunks rewrote or deleted, not pure insertions', () => {
	const show = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -3 +3 @@', '-x', '+y', '@@ -8,2 +7,0 @@', '-p', '-q', '@@ -20,0 +19,1 @@', '+new',
		'diff --git a/n.ts b/n.ts', 'new file mode 100644', '--- /dev/null', '+++ b/n.ts', '@@ -0,0 +1 @@', '+n'].join('\n');
	assert.deepEqual([...changedRanges(show)], [['a.ts', [[3, 3], [8, 9]]]]);
});

/** main with a.ts; a PR that rewrote line 3, tested at its head; fixes after it to line 3 and to line 8. */
function repo() {
	const dir = mkdtempSync(join(tmpdir(), 'origin-accuracy-'));
	const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 't@example.com');
	git('config', 'user.name', 't');
	const lines = Array.from({ length: 10 }, (_, i) => `const line${i + 1} = ${i + 1};`);
	const write = () => writeFileSync(join(dir, 'a.ts'), `${lines.join('\n')}\n`);
	write();
	git('add', '.');
	git('commit', '-qm', 'base');
	git('update-ref', 'refs/remotes/origin/main', 'HEAD');
	git('checkout', '-qb', 'pr');
	lines[2] = 'const line3 = 33;';
	write();
	git('commit', '-qam', 'the change');
	const tested = git('rev-parse', 'HEAD');
	lines[2] = 'const line3 = 34;';
	write();
	git('commit', '-qam', 'fix in the change');
	const inside = git('rev-parse', 'HEAD');
	lines[7] = 'const line8 = 88;';
	write();
	git('commit', '-qam', 'fix outside it');
	const outside = git('rev-parse', 'HEAD');
	return { dir, tested, inside, outside };
}

test('fixInChange says whether a fix changed lines the tested change wrote', () => {
	const { dir, tested, inside, outside } = repo();
	try {
		const git = args => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
		const row = commit => ({ pr: 7, testedSha: tested, outcome: 'fixed-in-pr', decidedBy: 'diff+model', evidence: `pr ${commit.slice(0, 10)}: yes`, paths: ['a.ts'] });
		assert.equal(fixInChange(git, row(inside)), true);
		assert.equal(fixInChange(git, row(outside)), false);
		assert.equal(fixInChange(git, { ...row(inside), paths: ['b.ts'] }), false);
		assert.equal(fixInChange(git, { ...row(inside), outcome: 'not-fixed' }), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the table counts each Origin against where its fix landed, and says when nothing can be measured', () => {
	const rows = [
		{ origin: 'introduced', fix: true }, { origin: 'introduced', fix: true }, { origin: 'introduced', fix: false },
		{ origin: 'inherited', fix: false }, { origin: null, fix: true }, { origin: 'exposed', fix: null },
	];
	assert.equal(renderAccuracy(tally(rows, r => r.fix)), [
		'### Origin accuracy', '', 'Findings fixed in the PR or later on main, by whether the fix changed lines the tested change wrote.', '',
		'| Origin | Fix in the change | Fix outside it | Right |', '|---|---|---|---|',
		'| Introduced | 2 | 1 | 2/3 (67%) |', '| Inherited | 0 | 1 | 1/1 (100%) |', '| None given | 1 | 0 | - |', '',
	].join('\n'));
	assert.match(renderAccuracy({}), /No fixed finding names its fix commits yet/);
});
