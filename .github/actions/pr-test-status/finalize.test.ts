/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { finalize, parseMode, readArtifacts } from './finalize.ts';
import type { Job } from './lanes.ts';
import type { Deps, State } from './statuses.ts';
import { parseDeadline } from './poll.ts';
import type { LaneOutput } from './render.ts';

const RUN = 'https://github.com/posit-dev/positron-builds/actions/runs/9';
const job = (name: string, conclusion: string | null): Job => ({
	id: 1, name, status: conclusion ? 'completed' : 'in_progress', conclusion, html_url: 'https://example.test/job/1',
});

type Write = { name: string; out: LaneOutput; url: string };

function fake(jobs: Job[] | Error, runStatus = 'completed'): { deps: Deps; writes: Write[] } {
	const f = { writes: [] as Write[], deps: null as unknown as Deps };
	f.deps = {
		runId: '9', headSha: 'abc', runUrl: RUN,
		listJobs: async () => {
			if (jobs instanceof Error) {
				throw jobs;
			}
			return jobs;
		},
		getRun: async () => ({ status: runStatus, conclusion: runStatus === 'completed' ? 'success' : null }),
		setStatus: async (_s, name, out, url) => {
			f.writes.push({ name, out, url });
		},
	};
	return f;
}

const open = (): State['statuses'][string] => ({ url: 'u', closed: false, out: { status: 'in_progress', title: 'Running', summary: 'x' } });
const tmp = (): string => mkdtempSync(join(tmpdir(), 'pr-test-status-'));

test('readArtifacts maps folders to lanes and a missing file to null', () => {
	const dir = tmp();
	const put = (folder: string, file: string, body: string): void => {
		mkdirSync(join(dir, folder), { recursive: true });
		writeFileSync(join(dir, folder, file), body);
	};
	put('e2e-results-e2e-electron-ubuntu', 'results.json', JSON.stringify({ stats: { expected: 2, unexpected: 0, skipped: 0, flaky: 0 }, suites: [] }));
	put('vitest-results', 'results.json', JSON.stringify({ numPassedTests: 5, numFailedTests: 0, testResults: [] }));
	put('unit-cache', 'cache.json', JSON.stringify([{ name: 'npm-core', hit: true }]));
	mkdirSync(join(dir, 'e2e-results-e2e-windows'));
	const a = readArtifacts(dir);
	assert.deepStrictEqual([...a.results.keys()].sort(), ['e2e / e2e-electron-ubuntu', 'e2e / e2e-windows', 'unit / vitest']);
	assert.strictEqual(a.results.get('e2e / e2e-windows'), null);
	assert.strictEqual(a.results.get('unit / vitest')?.passed, 5);
	assert.strictEqual(a.results.get('e2e / e2e-electron-ubuntu')?.passed, 2);
	assert.deepStrictEqual(a.cache.get('unit / vscode'), [{ name: 'npm-core', hit: true }]);
});

test('final links each lane into the builds run and returns the lane table', async () => {
	const dir = tmp();
	mkdirSync(join(dir, 'vitest-results'));
	writeFileSync(join(dir, 'vitest-results', 'results.json'), JSON.stringify({ numPassedTests: 5, numFailedTests: 0, testResults: [] }));
	const f = fake([job('unit / vitest-1', 'success')]);
	const state: State = { statuses: {}, readErrors: 0 };
	const summary = await finalize(f.deps, state, 'final', dir);
	assert.deepStrictEqual(f.writes.map(w => [w.name, w.out.title, w.url]), [['unit / vitest', '5 passed', 'https://example.test/job/1']]);
	assert.match(summary ?? '', /^\| \| Lane \| Result \|\n\|---\|---\|---\|\n\| \u{2705} \| `unit \/ vitest` \| 5 passed \|\n/u);
	assert.match(summary ?? '', /re-run required-tests/);
});

test('final retries a failed run read once before judging lanes', async () => {
	const f = fake([job('unit / vitest-1', 'success')]);
	let calls = 0;
	const getRun = f.deps.getRun;
	f.deps.getRun = async id => {
		if (calls++ === 0) {
			throw new Error('flaky');
		}
		return getRun(id);
	};
	await finalize(f.deps, { statuses: {}, readErrors: 0 }, 'final', tmp());
	assert.deepStrictEqual(f.writes.map(w => [w.name, w.out.conclusion]), [['unit / vitest', 'success']]);
});

test('final does not pass a lane closed as unreadable while the run is still going', async () => {
	const f = fake([job('e2e / e2e-electron-ubuntu-1', 'success')], 'in_progress');
	const unreadable = { url: RUN, closed: true, out: { status: 'completed', conclusion: 'neutral', title: 'Could not read the test run', summary: 'x' } as LaneOutput };
	const state: State = { statuses: { 'e2e / e2e-electron-ubuntu': unreadable }, readErrors: 0 };
	await finalize(f.deps, state, 'final', tmp());
	assert.deepStrictEqual(f.writes, []);
});

test('final closes running lanes as timed out, once, when the run is read but still going', async () => {
	const f = fake([job('unit / vitest-1', null), job('unit / vscode-1', 'failure')], 'in_progress');
	const state: State = { statuses: { 'unit / vitest': open() }, readErrors: 0 };
	await finalize(f.deps, state, 'final', tmp());
	assert.deepStrictEqual(f.writes.map(w => [w.name, w.out.title]), [['unit / vscode', 'Failed'], ['unit / vitest', 'Timed out']]);
});

test('final closes open lanes as unreadable when the run status cannot be read', async () => {
	const f = fake([job('unit / vitest-1', null)]);
	f.deps.getRun = async () => {
		throw new Error('down');
	};
	const state: State = { statuses: { 'unit / vitest': open() }, readErrors: 0 };
	await finalize(f.deps, state, 'final', tmp());
	assert.deepStrictEqual(f.writes.map(w => [w.name, w.out.title]), [['unit / vitest', 'Could not read the test run']]);
});

test('final closes every open lane as unreadable when jobs cannot be read', async () => {
	const f = fake(new Error('down'));
	const state: State = { statuses: { a: open(), b: open() }, readErrors: 0 };
	const summary = await finalize(f.deps, state, 'final', tmp());
	assert.deepStrictEqual(f.writes.map(w => [w.name, w.out.title, w.url]), [['a', 'Could not read the test run', RUN], ['b', 'Could not read the test run', RUN]]);
	assert.match(summary ?? '', /re-run required-tests/);
});

test('final closes a lane that is in the state but absent from the final jobs', async () => {
	const f = fake([job('unit / vitest-1', 'success')]);
	const state: State = { statuses: { 'e2e / gone': open() }, readErrors: 0 };
	await finalize(f.deps, state, 'final', tmp());
	assert.deepStrictEqual(f.writes.filter(w => w.name === 'e2e / gone').map(w => w.out.conclusion), ['neutral']);
	assert.strictEqual(state.statuses['e2e / gone'].closed, true);
});

test('final never reopens a closed lane that is running again', async () => {
	const f = fake([job('unit / vitest-1', null)]);
	const closed = { url: 'u', closed: true, out: { status: 'completed', conclusion: 'success', title: '5 passed', summary: 'x' } as LaneOutput };
	const state: State = { statuses: { 'unit / vitest': closed }, readErrors: 0 };
	await finalize(f.deps, state, 'final', tmp());
	assert.deepStrictEqual(f.writes, []);
	assert.strictEqual(state.statuses['unit / vitest'].closed, true);
});

test('final retries a failed write once', async () => {
	const f = fake([job('unit / vitest-1', 'success')]);
	let calls = 0;
	const write = f.deps.setStatus;
	f.deps.setStatus = async (s, n, o, u) => {
		if (calls++ === 0) {
			throw new Error('flaky');
		}
		return write(s, n, o, u);
	};
	const state: State = { statuses: {}, readErrors: 0 };
	await finalize(f.deps, state, 'final', tmp());
	assert.strictEqual(state.statuses['unit / vitest'].closed, true);
});

test('cancel and timeout close open lanes', async () => {
	for (const [mode, title] of [['cancel', 'Cancelled'], ['timeout', 'Timed out']] as const) {
		const f = fake([]);
		const state: State = { statuses: { a: open(), done: { ...open(), closed: true } }, readErrors: 0 };
		assert.strictEqual(await finalize(f.deps, state, mode, tmp()), null);
		assert.deepStrictEqual(f.writes.map(w => [w.name, w.out.title, w.url]), [['a', title, RUN]]);
	}
});

test('parseMode and parseDeadline reject bad values', () => {
	assert.strictEqual(parseMode('cancel'), 'cancel');
	assert.throws(() => parseMode(undefined));
	assert.throws(() => parseMode('finl'));
	assert.strictEqual(parseDeadline(undefined), 3300);
	assert.throws(() => parseDeadline('abc'));
	assert.throws(() => parseDeadline('0'));
	assert.throws(() => parseDeadline('-5'));
});
