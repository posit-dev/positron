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
import { parseDeadline, type Deps, type State } from './poll.ts';
import type { CheckOutput } from './render.ts';

const RUN = 'https://github.com/posit-dev/positron-builds/actions/runs/9';
const job = (name: string, conclusion: string | null): Job => ({
	id: 1, name, status: conclusion ? 'completed' : 'in_progress', conclusion, html_url: 'https://example.test/job/1',
});

function fake(jobs: Job[] | Error): { deps: Deps; created: string[]; updated: { id: number; out: CheckOutput }[] } {
	const f = { created: [] as string[], updated: [] as { id: number; out: CheckOutput }[], deps: null as unknown as Deps };
	f.deps = {
		runId: '9', headSha: 'abc', runUrl: RUN,
		listJobs: async () => {
			if (jobs instanceof Error) {
				throw jobs;
			}
			return jobs;
		},
		getRun: async () => ({ status: 'completed', conclusion: 'success' }),
		createCheck: async (_s, name) => {
			f.created.push(name);
			return 100 + f.created.length;
		},
		updateCheck: async (id, out) => {
			f.updated.push({ id, out });
		},
	};
	return f;
}

const openCheck = (id: number): State['checks'][string] => ({ id, closed: false, out: { status: 'in_progress', title: 'Running', summary: 'x' } });
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
	assert.strictEqual(a.results.get('unit / vitest')?.kind, 'vitest');
	assert.strictEqual(a.results.get('e2e / e2e-electron-ubuntu')?.kind, 'playwright');
	assert.deepStrictEqual(a.cache.get('unit / vscode'), [{ name: 'npm-core', hit: true }]);
});

test('final writes lanes with results and returns the summary', async () => {
	const dir = tmp();
	mkdirSync(join(dir, 'vitest-results'));
	writeFileSync(join(dir, 'vitest-results', 'results.json'), JSON.stringify({ numPassedTests: 5, numFailedTests: 0, testResults: [] }));
	const f = fake([job('unit / vitest-1', 'success')]);
	const state: State = { checks: {}, readErrors: 0 };
	const summary = await finalize(f.deps, state, 'final', dir);
	assert.deepStrictEqual(f.created, ['unit / vitest']);
	assert.strictEqual(state.checks['unit / vitest'].out.title, '5 passed');
	assert.match(summary ?? '', /Full run and artifacts/);
});

test('final closes every open check as unreadable when jobs cannot be read', async () => {
	const f = fake(new Error('down'));
	const state: State = { checks: { a: openCheck(1), b: openCheck(2) }, readErrors: 0 };
	const summary = await finalize(f.deps, state, 'final', tmp());
	assert.deepStrictEqual(f.updated.map(u => [u.id, u.out.title]), [[1, 'Could not read the test run'], [2, 'Could not read the test run']]);
	assert.match(summary ?? '', /Full run and artifacts/);
});

test('final closes a lane that is in the state but absent from the final jobs', async () => {
	const f = fake([job('unit / vitest-1', 'success')]);
	const state: State = { checks: { 'e2e / gone': openCheck(7) }, readErrors: 0 };
	await finalize(f.deps, state, 'final', tmp());
	assert.deepStrictEqual(f.updated.map(u => [u.id, u.out.conclusion]), [[7, 'neutral']]);
	assert.strictEqual(state.checks['e2e / gone'].closed, true);
});

test('final retries a failed write once', async () => {
	const f = fake([job('unit / vitest-1', 'success')]);
	let calls = 0;
	const create = f.deps.createCheck;
	f.deps.createCheck = async (s, n, o) => {
		if (calls++ === 0) {
			throw new Error('flaky');
		}
		return create(s, n, o);
	};
	const state: State = { checks: {}, readErrors: 0 };
	await finalize(f.deps, state, 'final', tmp());
	assert.strictEqual(state.checks['unit / vitest'].closed, true);
});

test('cancel and timeout close open checks', async () => {
	for (const [mode, title] of [['cancel', 'Cancelled'], ['timeout', 'Timed out']] as const) {
		const f = fake([]);
		const state: State = { checks: { a: openCheck(1), done: { ...openCheck(2), closed: true } }, readErrors: 0 };
		assert.strictEqual(await finalize(f.deps, state, mode, tmp()), null);
		assert.deepStrictEqual(f.updated.map(u => [u.id, u.out.title]), [[1, title]]);
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
