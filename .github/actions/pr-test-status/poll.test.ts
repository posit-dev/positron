/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Job } from './lanes.ts';
import type { CheckOutput } from './render.ts';
import type { Deps, State } from './checks.ts';
import { pollOnce } from './poll.ts';

const RUN = 'https://github.com/posit-dev/positron-builds/actions/runs/9';

const job = (name: string, status: Job['status'], conclusion: string | null = null): Job => ({
	id: 1, name, status, conclusion, html_url: 'https://example.test/job/1',
});

type Fake = { deps: Deps; created: { name: string; out: CheckOutput }[]; updated: { id: number; out: CheckOutput }[]; reads: { jobs: Job[]; run: { status: string; conclusion: string | null } | Error }[] };

/** Fakes that serve the queued reads in order (the last one repeats). */
function fake(reads: Fake['reads']): Fake {
	const f: Fake = { created: [], updated: [], reads, deps: null as unknown as Deps };
	let i = 0;
	const current = () => f.reads[Math.min(i, f.reads.length - 1)];
	f.deps = {
		runId: '9', headSha: 'abc', runUrl: RUN,
		listJobs: async () => current().jobs,
		getRun: async () => {
			const r = current().run;
			i++;
			if (r instanceof Error) {
				throw r;
			}
			return r;
		},
		createCheck: async (_sha, name, out) => {
			f.created.push({ name, out });
			return 100 + f.created.length;
		},
		updateCheck: async (id, out) => {
			f.updated.push({ id, out });
		},
	};
	return f;
}

const fresh = (): State => ({ checks: {}, readErrors: 0 });
const running = { status: 'in_progress', conclusion: null };

test('creates a check the first time a lane appears', async () => {
	const f = fake([{ jobs: [job('unit / vitest', 'in_progress')], run: running }]);
	const state = fresh();
	const res = await pollOnce(f.deps, state);
	assert.deepStrictEqual(res, { done: false, conclusion: null });
	assert.deepStrictEqual(f.created.map(c => [c.name, c.out.status, c.out.title]), [['unit / vitest', 'in_progress', 'Running']]);
	assert.strictEqual(state.checks['unit / vitest'].id, 101);
	assert.strictEqual(state.checks['unit / vitest'].closed, false);
});

test('does not update when the rendered output is unchanged', async () => {
	const f = fake([{ jobs: [job('unit / vitest', 'in_progress')], run: running }]);
	const state = fresh();
	await pollOnce(f.deps, state);
	await pollOnce(f.deps, state);
	assert.strictEqual(f.created.length, 1);
	assert.strictEqual(f.updated.length, 0);
});

test('updates when a lane completes', async () => {
	const f = fake([
		{ jobs: [job('unit / vitest', 'in_progress')], run: running },
		{ jobs: [job('unit / vitest', 'completed', 'success')], run: { status: 'completed', conclusion: 'success' } },
	]);
	const state = fresh();
	await pollOnce(f.deps, state);
	await pollOnce(f.deps, state);
	assert.deepStrictEqual(f.updated.map(u => [u.id, u.out.conclusion]), [[101, 'success']]);
	assert.strictEqual(state.checks['unit / vitest'].closed, true);
});

test('returns done when the run completes', async () => {
	const f = fake([{ jobs: [job('unit / vitest', 'completed', 'failure')], run: { status: 'completed', conclusion: 'failure' } }]);
	const res = await pollOnce(f.deps, fresh());
	assert.deepStrictEqual(res, { done: true, conclusion: 'failure' });
	assert.strictEqual(f.created[0].out.conclusion, 'failure');
});

test('three read errors in a row close open checks as unreadable and return conclusion failure', async () => {
	const f = fake([
		{ jobs: [job('unit / vitest', 'in_progress')], run: running },
		{ jobs: [], run: new Error('boom') },
	]);
	const state = fresh();
	await pollOnce(f.deps, state);
	assert.deepStrictEqual(await pollOnce(f.deps, state), { done: false, conclusion: null });
	assert.deepStrictEqual(await pollOnce(f.deps, state), { done: false, conclusion: null });
	assert.deepStrictEqual(await pollOnce(f.deps, state), { done: true, conclusion: 'failure' });
	assert.deepStrictEqual(f.updated.map(u => [u.id, u.out.conclusion, u.out.title]), [[101, 'neutral', 'Could not read the test run']]);
	assert.strictEqual(state.checks['unit / vitest'].closed, true);
});

test('one read error then success keeps going', async () => {
	const f = fake([
		{ jobs: [], run: new Error('boom') },
		{ jobs: [job('unit / vitest', 'in_progress')], run: running },
	]);
	const state = fresh();
	assert.deepStrictEqual(await pollOnce(f.deps, state), { done: false, conclusion: null });
	assert.strictEqual(state.readErrors, 1);
	assert.deepStrictEqual(await pollOnce(f.deps, state), { done: false, conclusion: null });
	assert.strictEqual(state.readErrors, 0);
	assert.strictEqual(f.created.length, 1);
});

test('a failed write leaves the state unchanged and retries on the next poll', async () => {
	const f = fake([{ jobs: [job('unit / vitest', 'in_progress')], run: running }]);
	const create = f.deps.createCheck;
	let fail = true;
	f.deps.createCheck = async (s, n, o) => {
		if (fail) {
			throw new Error('nope');
		}
		return create(s, n, o);
	};
	const state = fresh();
	await pollOnce(f.deps, state);
	assert.deepStrictEqual(state.checks, {});
	fail = false;
	await pollOnce(f.deps, state);
	assert.strictEqual(state.checks['unit / vitest'].id, 101);
});

test('a lane whose jobs are all done stays running while the run is going', async () => {
	const f = fake([{ jobs: [job('e2e / e2e-electron-ubuntu-1', 'completed', 'success')], run: running }]);
	const state = fresh();
	await pollOnce(f.deps, state);
	assert.deepStrictEqual(f.created.map(c => [c.out.status, c.out.title]), [['in_progress', 'Running']]);
	assert.strictEqual(state.checks['e2e / e2e-electron-ubuntu'].closed, false);
});

test('a failed lane still shows failure while the run is going', async () => {
	const f = fake([{ jobs: [job('e2e / e2e-electron-ubuntu-1', 'completed', 'failure')], run: running }]);
	await pollOnce(f.deps, fresh());
	assert.strictEqual(f.created[0].out.conclusion, 'failure');
});

test('a failed lane is not reopened when a later job of the lane starts', async () => {
	const f = fake([
		{ jobs: [job('e2e / e2e-electron-ubuntu-1', 'completed', 'failure')], run: running },
		{ jobs: [job('e2e / e2e-electron-ubuntu-1', 'completed', 'failure'), job('e2e / e2e-electron-ubuntu-scan-1', 'in_progress')], run: running },
	]);
	const state = fresh();
	await pollOnce(f.deps, state);
	await pollOnce(f.deps, state);
	assert.deepStrictEqual([f.created.map(c => c.out.status), f.updated.length], [['completed'], 0]);
});

test('unexpanded template job names never create a check', async () => {
	const f = fake([{
		jobs: [
			job('e2e / ${{ (inputs.display_name || \'e2e-linux\') }}-publish', 'completed', 'skipped'),
			job('e2e / inputs.display_name || \'e2e-linux\'', 'queued'),
			job('unit / vitest', 'in_progress'),
		],
		run: running,
	}]);
	await pollOnce(f.deps, fresh());
	assert.deepStrictEqual(f.created.map(c => c.name), ['unit / vitest']);
});

test('poll.ts writes code and conclusion to GITHUB_OUTPUT', () => {
	const out = join(mkdtempSync(join(tmpdir(), 'poll-')), 'output');
	// No RUN_ID: the poll crashes right away, which is code 1 with no conclusion.
	spawnSync(process.execPath, [join(import.meta.dirname, 'poll.ts')], { env: { PATH: process.env.PATH, GITHUB_OUTPUT: out } });
	assert.strictEqual(readFileSync(out, 'utf8'), 'code=1\nconclusion=\n');
});
