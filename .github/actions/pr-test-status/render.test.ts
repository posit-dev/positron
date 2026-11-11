/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Job, Lane } from './lanes.ts';
import type { Results } from './results.ts';
import { renderLane, renderRequiredSummary, renderUnreadable } from './render.ts';

const RUN = 'https://github.com/o/r/actions/runs/9';

const job = (name: string, conclusion: string | null, extra: Partial<Job> = {}): Job => ({
	id: 1, name, status: conclusion ? 'completed' : 'in_progress', conclusion, html_url: `https://github.com/o/r/actions/runs/9/job/${name.length}${name.slice(-1)}`, ...extra,
});

const lane = (name: string, state: Lane['state'], jobs: Job[]): Lane => ({ name, state, jobs });

const results = (over: Partial<Results>): Results => ({
	kind: 'vitest', passed: 0, failed: 0, skipped: 0, flaky: 0, expectedFailures: 0, files: null, failures: [], flakyTests: [], ...over,
});

test('in progress', () => {
	const out = renderLane(lane('unit', 'in_progress', [job('unit / run-1', null)]), RUN, null, null);
	assert.deepStrictEqual(out, { status: 'in_progress', title: 'Running', summary: `\n[Full run and artifacts](${RUN})\n` });
});

test('passed with results', () => {
	const l = lane('unit', 'success', [job('unit / run-1', 'success')]);
	const out = renderLane(l, RUN, results({ passed: 612, files: { passed: 3, failed: 0, total: 3 } }), null);
	assert.strictEqual(out.title, '612 passed');
	assert.strictEqual(out.conclusion, 'success');
	assert.strictEqual(out.summary, [
		'## Vitest Test Report', '', '### Summary', '',
		'- **Test Files**: \u{2705} **3 passes** \u{B7} 3 total',
		'- **Test Results**: \u{2705} **612 passes** \u{B7} 612 total',
		'', `[Full run and artifacts](${RUN})`, '',
	].join('\n'));
});

test('passed without results', () => {
	const out = renderLane(lane('unit', 'success', [job('unit / run-1', 'success')]), RUN, null, null);
	assert.strictEqual(out.title, 'Passed');
	assert.strictEqual(out.summary, `\n[Full run and artifacts](${RUN})\n`);
});

test('failed vitest', () => {
	const j = job('unit / run-1', 'failure');
	const r = results({
		passed: 10, failed: 1, skipped: 2, files: { passed: 1, failed: 1, total: 2 },
		failures: [{ file: 'src/a.vitest.ts', title: 'suite > it breaks', shard: null }],
	});
	const out = renderLane(lane('unit', 'failure', [j]), RUN, r, null);
	assert.strictEqual(out.title, '1 test failed');
	assert.strictEqual(out.conclusion, 'failure');
	assert.strictEqual(out.summary, [
		'## Vitest Test Report', '', '### Summary', '',
		'- **Test Files**: \u{274C} **1 failure** \u{B7} \u{2705} **1 pass** \u{B7} 2 total',
		'- **Test Results**: \u{274C} **1 failure** \u{B7} \u{2705} **10 passes** \u{B7} 11 total',
		'- **Other**: 2 skips \u{B7} 2 total',
		'', '### Failed', '',
		`- \`src/a.vitest.ts\` > \`suite > it breaks\` - [log](${j.html_url})`,
		'', `[Full run and artifacts](${RUN})`, '',
	].join('\n'));
});

test('failed e2e links the shard job, or every failed job without a shard', () => {
	const j1 = job('e2e / e2e-electron-ubuntu-1', 'failure');
	const j2 = job('e2e / e2e-electron-ubuntu-2', 'failure');
	const j3 = job('e2e / e2e-electron-ubuntu-3', 'success');
	const r = results({
		kind: 'playwright', passed: 7, failed: 2, flaky: 1, skipped: 1,
		failures: [
			{ file: 'b.test.ts', title: 'does <b>', shard: 2 },
			{ file: 'a.test.ts', title: 'one', shard: null },
		],
		flakyTests: [{ file: 'c.test.ts', title: 'wobbly', shard: 1 }],
	});
	const out = renderLane(lane('e2e / e2e-electron-ubuntu', 'failure', [j1, j2, j3]), RUN, r, null);
	assert.strictEqual(out.title, '2 tests failed');
	assert.strictEqual(out.summary, [
		'\u{1F9EA} Total: 11 | \u{2705} Pass: 7 | \u{274C} Fail: 2 | \u{26A0}\u{FE0F} Flaky: 1 | \u{23ED}\u{FE0F} Skipped: 1',
		'',
		'<details><summary>\u{274C} <code>a.test.ts</code></summary>', '',
		`- \`one\` - [log](${j1.html_url}) [log](${j2.html_url})`,
		'</details>', '',
		'<details><summary>\u{274C} <code>b.test.ts</code></summary>', '',
		`- \`does <b>\` - [log](${j2.html_url})`,
		'</details>', '',
		'<details><summary>\u{26A0}\u{FE0F} <code>c.test.ts</code></summary>', '',
		`- \`wobbly\` - [log](${j1.html_url})`,
		'</details>',
		'', `[Full run and artifacts](${RUN})`, '',
	].join('\n'));
});

test('file names are escaped inside summary html', () => {
	const j = job('e2e / e2e-electron-ubuntu-1', 'failure');
	const r = results({ kind: 'playwright', failed: 1, failures: [{ file: 'a<img>&.ts', title: 't', shard: 1 }] });
	const out = renderLane(lane('e2e', 'failure', [j]), RUN, r, null);
	assert.ok(out.summary.includes('<code>a&lt;img&gt;&amp;.ts</code>'));
});

test('failed without results', () => {
	const j = job('unit / run-1', 'failure', { steps: [{ name: 'Install', conclusion: 'success' }, { name: 'Run tests', conclusion: 'failure' }] });
	const out = renderLane(lane('unit', 'failure', [j, job('unit / run-2', 'success')]), RUN, null, null);
	assert.strictEqual(out.title, 'Failed');
	assert.strictEqual(out.summary, [
		'', '### Failed jobs', '',
		`- \`unit / run-1\`: \`Run tests\` - [log](${j.html_url})`,
		'', `[Full run and artifacts](${RUN})`, '',
	].join('\n'));
});

test('vscode with cache', () => {
	const out = renderLane(lane('unit / vscode', 'success', [job('unit / vscode-1', 'success')]), RUN, null, [
		{ name: 'npm-core', hit: true }, { name: 'npm-ext-volatile', hit: false }, { name: 'npm-ext-stable', hit: true },
		{ name: 'builtins', hit: true }, { name: 'playwright', hit: false },
	]);
	assert.strictEqual(out.summary, [
		'', '<details><summary>Cache</summary>', '',
		'- `npm-core` \u{2705} hit', '- `npm-ext-volatile` \u{274C} miss', '- `npm-ext-stable` \u{2705} hit',
		'- `builtins` \u{2705} hit', '- `playwright` \u{274C} miss',
		'</details>', '', `[Full run and artifacts](${RUN})`, '',
	].join('\n'));
});

test('summary over 60000 chars is cut', () => {
	const j = job('e2e / e2e-electron-ubuntu-1', 'failure');
	const failures = Array.from({ length: 400 }, (_, i) => ({ file: `f${String(i).padStart(3, '0')}.test.ts`, title: 'x'.repeat(150), shard: 1 }));
	const out = renderLane(lane('e2e', 'failure', [j]), RUN, results({ kind: 'playwright', failed: 400, failures }), null);
	assert.ok(out.summary.length <= 60000);
	assert.ok(/\n_\d+ more not shown\. See the full run\._\n/.test(out.summary));
	assert.ok(out.summary.endsWith(`[Full run and artifacts](${RUN})\n`));
	assert.ok(out.summary.includes('f000.test.ts'));
});

test('unreadable, timed out, cancelled', () => {
	assert.strictEqual(renderUnreadable(RUN, 'unreadable').title, 'Could not read the test run');
	assert.strictEqual(renderUnreadable(RUN, 'timed_out').title, 'Timed out');
	assert.strictEqual(renderUnreadable(RUN, 'timed_out').conclusion, 'timed_out');
	const c = renderUnreadable(RUN, 'cancelled');
	assert.deepStrictEqual([c.title, c.conclusion], ['Cancelled', 'cancelled']);
	assert.ok(renderUnreadable(RUN, 'unreadable').summary.startsWith('The test results could not be read.'));
});

test('renderRequiredSummary resolve failure', () => {
	const j = job('resolve PR 17', 'failure', { steps: [{ name: 'Checkout', conclusion: 'success' }, { name: 'Wait for the merge commit', conclusion: 'failure' }] });
	assert.strictEqual(renderRequiredSummary([j], RUN), [
		`Could not prepare the PR for testing: \`Wait for the merge commit\` - [log](${j.html_url})`, '',
		'The PR may have conflicts with its base, or GitHub had not finished preparing its merge commit.', '',
		`[Full run and artifacts](${RUN})`, '',
		'To re-run the tests, re-run required-tests on this PR. Re-running jobs in positron-builds does not update the PR.', '',
	].join('\n'));
});

test('renderRequiredSummary normal run', () => {
	assert.strictEqual(renderRequiredSummary([job('resolve PR 17', 'success'), job('unit / run-1', 'success')], RUN), [
		`[Full run and artifacts](${RUN})`, '',
		'To re-run the tests, re-run required-tests on this PR. Re-running jobs in positron-builds does not update the PR.', '',
	].join('\n'));
});

test('names are sanitized into code spans; empty names become (unnamed)', () => {
	const j = job('unit / run`1', 'failure', { steps: [{ name: 'Run `evil` tests', conclusion: 'failure' }] });
	const out = renderLane(lane('unit', 'failure', [j]), RUN, null, null);
	assert.strictEqual(out.summary, [
		'', '### Failed jobs', '',
		`- \`unit / run1\`: \`Run evil tests\` - [log](${j.html_url})`,
		'', `[Full run and artifacts](${RUN})`, '',
	].join('\n'));
	const empty = job('resolve PR 17', 'failure', { steps: [{ name: '```', conclusion: 'failure' }] });
	assert.strictEqual(renderRequiredSummary([empty], RUN).split('\n')[0],
		`Could not prepare the PR for testing: \`(unnamed)\` - [log](${empty.html_url})`);
});

test('vitest flaky tests are not listed under Failed', () => {
	const j = job('unit / run-1', 'success');
	const r = results({ passed: 1, flakyTests: [{ file: 'src/a.vitest.ts', title: '', shard: null }] });
	const out = renderLane(lane('unit', 'success', [j]), RUN, r, null);
	assert.ok(!out.summary.includes('### Failed'));
	const f = results({ failed: 1, failures: [{ file: 'src/a.vitest.ts', title: '`', shard: null }] });
	assert.ok(renderLane(lane('unit', 'failure', [job('unit / run-1', 'failure')]), RUN, f, null).summary.includes('- `src/a.vitest.ts` - '));
});

test('a long file path and a long title are both fully shown', () => {
	const file = `${'d'.repeat(55)}/${'e'.repeat(54)}.vitest.ts`;
	const title = 't'.repeat(100);
	const r = results({ failed: 1, failures: [{ file, title, shard: null }] });
	const out = renderLane(lane('unit', 'failure', [job('unit / run-1', 'failure')]), RUN, r, null);
	assert.ok(out.summary.includes(`- \`${file}\` > \`${title}\` - `));
});

test('the log link matches a shard job, not a scan job, whatever the order', () => {
	const scan = job('e2e / e2e-electron-ubuntu-scan-1', 'failure', { html_url: 'https://example.test/scan' });
	const shard = job('e2e / e2e-electron-ubuntu-1', 'failure', { html_url: 'https://example.test/shard' });
	const r = results({ kind: 'playwright', failed: 1, failures: [{ file: 'a.test.ts', title: 'one', shard: 1 }] });
	const out = renderLane(lane('e2e / e2e-electron-ubuntu', 'failure', [scan, shard]), RUN, r, null);
	assert.ok(out.summary.includes('- `one` - [log](https://example.test/shard)\n'));
});

test('a flaky test under a failed file is marked flaky', () => {
	const j = job('e2e / e2e-electron-ubuntu-1', 'failure');
	const r = results({
		kind: 'playwright', failed: 1, flaky: 1,
		failures: [{ file: 'a.test.ts', title: 'broken', shard: 1 }],
		flakyTests: [{ file: 'a.test.ts', title: 'wobbly', shard: 1 }],
	});
	const out = renderLane(lane('e2e', 'failure', [j]), RUN, r, null);
	assert.ok(out.summary.includes(`- \`wobbly\` (flaky) - [log](${j.html_url})`));
	assert.ok(out.summary.includes(`- \`broken\` - [log](${j.html_url})`));
});
