/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Job, Lane } from './lanes.ts';
import type { Results } from './results.ts';
import { renderLane, renderLanes, renderRequiredSummary, renderUnreadable } from './render.ts';

const RUN = 'https://github.com/o/r/actions/runs/9';
const RERUN = '<sub>To re-run the tests, re-run required-tests on this PR. Re-running jobs in positron-builds does not update the PR.</sub>';

const job = (name: string, conclusion: string | null, extra: Partial<Job> = {}): Job => ({
	id: 1, name, status: conclusion ? 'completed' : 'in_progress', conclusion, html_url: `https://github.com/o/r/actions/runs/9/job/${name.length}${name.slice(-1)}`, ...extra,
});

const lane = (name: string, state: Lane['state'], jobs: Job[]): Lane => ({ name, state, jobs });

const results = (over: Partial<Results>): Results => ({
	passed: 0, failed: 0, failures: [], flakyTests: [], ...over,
});

test('in progress', () => {
	const out = renderLane(lane('unit', 'in_progress', [job('unit / run-1', null)]), null, null);
	assert.deepStrictEqual(out, { status: 'in_progress', title: 'Running', summary: '' });
});

test('passed with results has no details', () => {
	const out = renderLane(lane('unit', 'success', [job('unit / run-1', 'success')]), results({ passed: 612 }), null);
	assert.deepStrictEqual([out.title, out.conclusion, out.summary], ['612 passed', 'success', '']);
});

test('passed without results', () => {
	const out = renderLane(lane('unit', 'success', [job('unit / run-1', 'success')]), null, null);
	assert.deepStrictEqual([out.title, out.summary], ['Passed', '']);
});

test('failed without results has no details; the table links the log', () => {
	const j = job('unit / run-1', 'failure', { steps: [{ name: 'Run tests', conclusion: 'failure' }] });
	const out = renderLane(lane('unit', 'failure', [j]), null, null);
	assert.deepStrictEqual([out.title, out.summary], ['Failed', '']);
});

test('failed tests are listed by file without log links; flaky tests come last', () => {
	const r = results({
		passed: 7, failed: 2,
		failures: [
			{ file: 'b.test.ts', title: 'does <b>' },
			{ file: 'a.test.ts', title: 'one' },
		],
		flakyTests: [{ file: 'c.test.ts', title: 'wobbly' }],
	});
	const out = renderLane(lane('e2e / e2e-electron-ubuntu', 'failure', [job('e2e / e2e-electron-ubuntu-1', 'success'), job('e2e / e2e-electron-ubuntu', 'failure')]), r, null);
	assert.strictEqual(out.title, '2 tests failed');
	assert.strictEqual(out.summary, [
		'- `a.test.ts` > `one`',
		'- `b.test.ts` > `does <b>`',
		'- \u{26A0}\u{FE0F} `c.test.ts` > `wobbly` (flaky)',
		'',
	].join('\n'));
});

test('vscode with cache', () => {
	const out = renderLane(lane('unit / vscode', 'success', [job('unit / vscode-1', 'success')]), null, [
		{ name: 'npm-core', hit: true }, { name: 'playwright', hit: false },
	]);
	assert.strictEqual(out.summary, ['', '**Cache**', '', '- `npm-core` \u{2705} hit', '- `playwright` \u{274C} miss', ''].join('\n'));
});

test('summary over 60000 chars is cut', () => {
	const j = job('e2e / e2e-electron-ubuntu-1', 'failure');
	const failures = Array.from({ length: 400 }, (_, i) => ({ file: `f${String(i).padStart(3, '0')}.test.ts`, title: 'x'.repeat(150) }));
	const out = renderLane(lane('e2e', 'failure', [j]), results({ failed: 400, failures }), null);
	assert.ok(out.summary.length <= 60000);
	assert.ok(out.summary.endsWith('See the full run._\n'));
	assert.ok(out.summary.includes('f000.test.ts'));
});

test('unreadable, timed out, cancelled', () => {
	assert.strictEqual(renderUnreadable('unreadable').title, 'Could not read the test run');
	assert.strictEqual(renderUnreadable('timed_out').title, 'Timed out');
	assert.strictEqual(renderUnreadable('timed_out').conclusion, 'timed_out');
	const c = renderUnreadable('cancelled');
	assert.deepStrictEqual([c.title, c.conclusion], ['Cancelled', 'cancelled']);
});

test('renderLanes: a table with failures first, then a folded section for each lane with details', () => {
	const vitest = job('unit / vitest', 'failure');
	const e2e = [job('e2e / e2e-electron-ubuntu-1', 'success'), job('e2e / e2e-electron-ubuntu-2', 'success')];
	const vitestLane = lane('unit / vitest', 'failure', [vitest]);
	const out = renderLanes([
		{ lane: lane('e2e / e2e-electron-ubuntu', 'success', e2e), out: renderLane(lane('e2e / e2e-electron-ubuntu', 'success', e2e), null, null) },
		{ lane: lane('unit / vscode', 'success', [job('unit / vscode', 'success')]), out: renderLane(lane('unit / vscode', 'success', []), null, [{ name: 'npm-core', hit: true }]) },
		{ lane: vitestLane, out: renderLane(vitestLane, results({ failed: 1, failures: [{ file: 'a.vitest.ts', title: 'breaks' }] }), null) },
		{ lane: lane('e2e / e2e-windows', 'failure', e2e), out: renderLane(lane('e2e / e2e-windows', 'failure', e2e), null, null) },
	], RUN);
	assert.strictEqual(out, [
		'| | Lane | Result |',
		'|---|---|---|',
		`| \u{274C} | \`e2e / e2e-windows\` | Failed - [run](${RUN}) |`,
		`| \u{274C} | \`unit / vitest\` | 1 test failed - [log](${vitest.html_url}) |`,
		'| \u{2705} | `e2e / e2e-electron-ubuntu` | Passed |',
		'| \u{2705} | `unit / vscode` | Passed |',
		'',
		'<details><summary>\u{274C} <code>unit / vitest</code>: 1 test failed</summary>',
		'',
		'- `a.vitest.ts` > `breaks`',
		'',
		'</details>',
		'',
		'<details><summary>\u{2705} <code>unit / vscode</code>: Passed</summary>',
		'',
		'',
		'**Cache**',
		'',
		'- `npm-core` \u{2705} hit',
		'',
		'</details>',
		'',
	].join('\n'));
});

test('renderLanes escapes names in the table and in html', () => {
	const l = lane('a|b<c>', 'success', [job('x', 'success')]);
	const out = renderLanes([{ lane: l, out: { status: 'completed', conclusion: 'success', title: 'Passed', summary: 'x\n' } }], RUN);
	assert.ok(out.includes('| `a\\|b<c>` |'));
	assert.ok(out.includes('<code>a|b&lt;c&gt;</code>'));
});

test('renderLanes drops folded sections that would push the page over its cap', () => {
	const big = 'x'.repeat(59000) + '\n';
	const lanes = Array.from({ length: 20 }, (_, i) => {
		const l = lane(`e2e / lane-${String(i).padStart(2, '0')}`, 'failure', [job('x', 'failure')]);
		return { lane: l, out: { status: 'completed', conclusion: 'failure', title: 'Failed', summary: big } as const };
	});
	const out = renderLanes(lanes, RUN);
	assert.ok(Buffer.byteLength(out) <= 900000);
	assert.strictEqual(out.split('| \u{274C} |').length - 1, 20);
	assert.match(out, /_Details for \d+ more lanes not shown\. See the full run\._\n$/);
});

test('renderRequiredSummary resolve failure', () => {
	const j = job('resolve PR 17', 'failure', { steps: [{ name: 'Checkout', conclusion: 'success' }, { name: 'Wait for the merge commit', conclusion: 'failure' }] });
	assert.strictEqual(renderRequiredSummary([j]), [
		`Could not prepare the PR for testing: \`Wait for the merge commit\` - [log](${j.html_url})`, '',
		'The PR may have conflicts with its base, or GitHub had not finished preparing its merge commit.', '',
		RERUN, '',
	].join('\n'));
});

test('renderRequiredSummary normal run', () => {
	assert.strictEqual(renderRequiredSummary([job('resolve PR 17', 'success'), job('unit / run-1', 'success')]), RERUN + '\n');
});

test('names are sanitized into code spans; empty names become (unnamed)', () => {
	const r = results({ failed: 1, failures: [{ file: 'a`.ts', title: 'Run `evil` tests' }] });
	const j = job('unit / run-1', 'failure');
	assert.ok(renderLane(lane('unit', 'failure', [j]), r, null).summary.startsWith('- `a.ts` > `Run evil tests`\n'));
	const empty = job('resolve PR 17', 'failure', { steps: [{ name: '```', conclusion: 'failure' }] });
	assert.strictEqual(renderRequiredSummary([empty]).split('\n')[0],
		`Could not prepare the PR for testing: \`(unnamed)\` - [log](${empty.html_url})`);
});

test('a test whose title is empty or the file shows the file only', () => {
	const f = results({ failed: 1, failures: [{ file: 'src/a.vitest.ts', title: '`' }] });
	assert.ok(renderLane(lane('unit', 'failure', [job('unit / run-1', 'failure')]), f, null).summary.startsWith('- `src/a.vitest.ts`\n'));
});

test('a long file path and a long title are both fully shown', () => {
	const file = `${'d'.repeat(55)}/${'e'.repeat(54)}.vitest.ts`;
	const title = 't'.repeat(100);
	const r = results({ failed: 1, failures: [{ file, title }] });
	const out = renderLane(lane('unit', 'failure', [job('unit / run-1', 'failure')]), r, null);
	assert.ok(out.summary.includes(`- \`${file}\` > \`${title}\`\n`));
});

test('the table links the one failed job of a multi-job lane', () => {
	const merge = job('e2e / e2e-electron-ubuntu', 'failure');
	const l = lane('e2e / e2e-electron-ubuntu', 'failure', [job('e2e / e2e-electron-ubuntu-1', 'success'), merge]);
	const out = renderLanes([{ lane: l, out: renderLane(l, null, null) }], RUN);
	assert.ok(out.includes(`| Failed - [log](${merge.html_url}) |`));
});
