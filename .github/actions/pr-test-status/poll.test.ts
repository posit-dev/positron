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
import type { LaneOutput } from './render.ts';
import type { Deps, State } from './statuses.ts';
import { pollOnce } from './poll.ts';

const RUN = 'https://github.com/posit-dev/positron-builds/actions/runs/9';

const job = (name: string, status: Job['status'], conclusion: string | null = null): Job => ({
	id: 1, name, status, conclusion, html_url: 'https://example.test/job/1',
});

type Write = { name: string; out: LaneOutput; url: string };
type Fake = { deps: Deps; writes: Write[]; reads: { jobs: Job[]; run: { status: string; conclusion: string | null } | Error }[] };

/** Fakes that serve the queued reads in order (the last one repeats), one per poll. */
function fake(reads: Fake['reads']): Fake {
	const f: Fake = { writes: [], reads, deps: null as unknown as Deps };
	let i = 0;
	let read = f.reads[0];
	f.deps = {
		runId: '9', headSha: 'abc', runUrl: RUN,
		// The poll reads the run first, so getRun takes the next read and listJobs reuses it.
		listJobs: async () => read.jobs,
		getRun: async () => {
			read = f.reads[Math.min(i++, f.reads.length - 1)];
			const r = read.run;
			if (r instanceof Error) {
				throw r;
			}
			return r;
		},
		setStatus: async (_sha, name, out, url) => {
			f.writes.push({ name, out, url });
		},
	};
	return f;
}

const fresh = (): State => ({ statuses: {}, readErrors: 0 });
const running = { status: 'in_progress', conclusion: null };

test('sets a status the first time a lane appears, linking a one-job lane to its job', async () => {
	const f = fake([{ jobs: [job('unit / vitest', 'in_progress')], run: running }]);
	const state = fresh();
	const res = await pollOnce(f.deps, state);
	assert.deepStrictEqual(res, { done: false, conclusion: null });
	assert.deepStrictEqual(f.writes.map(w => [w.name, w.out.status, w.out.title, w.url]), [['unit / vitest', 'in_progress', 'Running', 'https://example.test/job/1']]);
	assert.strictEqual(state.statuses['unit / vitest'].closed, false);
});

test('a lane with several jobs links to the whole builds run', async () => {
	const f = fake([{ jobs: [job('e2e / e2e-electron-ubuntu-1', 'in_progress'), job('e2e / e2e-electron-ubuntu-2', 'in_progress')], run: running }]);
	await pollOnce(f.deps, fresh());
	assert.deepStrictEqual(f.writes.map(w => w.url), [RUN]);
});

test('does not update when the rendered output is unchanged', async () => {
	const f = fake([{ jobs: [job('unit / vitest', 'in_progress')], run: running }]);
	const state = fresh();
	await pollOnce(f.deps, state);
	await pollOnce(f.deps, state);
	assert.strictEqual(f.writes.length, 1);
});

test('a change to the summary alone does not write the status again', async () => {
	const f = fake([{ jobs: [job('unit / vitest', 'in_progress')], run: running }]);
	const state = fresh();
	await pollOnce(f.deps, state);
	state.statuses['unit / vitest'].out.summary = 'older summary';
	await pollOnce(f.deps, state);
	assert.strictEqual(f.writes.length, 1);
});

test('updates when a lane completes', async () => {
	const f = fake([
		{ jobs: [job('unit / vitest', 'in_progress')], run: running },
		{ jobs: [job('unit / vitest', 'completed', 'success')], run: { status: 'completed', conclusion: 'success' } },
	]);
	const state = fresh();
	await pollOnce(f.deps, state);
	await pollOnce(f.deps, state);
	assert.deepStrictEqual(f.writes.map(w => w.out.conclusion), [undefined, 'success']);
	assert.strictEqual(state.statuses['unit / vitest'].closed, true);
});

test('returns done when the run completes', async () => {
	const f = fake([{ jobs: [job('unit / vitest', 'completed', 'failure')], run: { status: 'completed', conclusion: 'failure' } }]);
	const res = await pollOnce(f.deps, fresh());
	assert.deepStrictEqual(res, { done: true, conclusion: 'failure' });
	assert.strictEqual(f.writes[0].out.conclusion, 'failure');
});

test('three read errors in a row close open lanes as unreadable and return conclusion failure', async () => {
	const f = fake([
		{ jobs: [job('unit / vitest', 'in_progress')], run: running },
		{ jobs: [], run: new Error('boom') },
	]);
	const state = fresh();
	await pollOnce(f.deps, state);
	assert.deepStrictEqual(await pollOnce(f.deps, state), { done: false, conclusion: null });
	assert.deepStrictEqual(await pollOnce(f.deps, state), { done: false, conclusion: null });
	assert.deepStrictEqual(await pollOnce(f.deps, state), { done: true, conclusion: 'failure' });
	assert.deepStrictEqual(f.writes.slice(1).map(w => [w.out.conclusion, w.out.title, w.url]), [['neutral', 'Could not read the test run', RUN]]);
	assert.strictEqual(state.statuses['unit / vitest'].closed, true);
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
	assert.strictEqual(f.writes.length, 1);
});

test('a failed write leaves the state unchanged and retries on the next poll', async () => {
	const f = fake([{ jobs: [job('unit / vitest', 'in_progress')], run: running }]);
	const write = f.deps.setStatus;
	let fail = true;
	f.deps.setStatus = async (s, n, o, u) => {
		if (fail) {
			throw new Error('nope');
		}
		return write(s, n, o, u);
	};
	const state = fresh();
	await pollOnce(f.deps, state);
	assert.deepStrictEqual(state.statuses, {});
	fail = false;
	await pollOnce(f.deps, state);
	assert.deepStrictEqual(f.writes.map(w => w.name), ['unit / vitest']);
});

test('a lane whose jobs are all done stays running while the run is going', async () => {
	const f = fake([{ jobs: [job('e2e / e2e-electron-ubuntu-1', 'completed', 'success')], run: running }]);
	const state = fresh();
	await pollOnce(f.deps, state);
	assert.deepStrictEqual(f.writes.map(w => [w.out.status, w.out.title]), [['in_progress', 'Running']]);
	assert.strictEqual(state.statuses['e2e / e2e-electron-ubuntu'].closed, false);
});

test('a failed lane still shows failure while the run is going', async () => {
	const f = fake([{ jobs: [job('e2e / e2e-electron-ubuntu-1', 'completed', 'failure')], run: running }]);
	await pollOnce(f.deps, fresh());
	assert.strictEqual(f.writes[0].out.conclusion, 'failure');
});

test('a failed lane is not reopened when a later job of the lane starts', async () => {
	const f = fake([
		{ jobs: [job('e2e / e2e-electron-ubuntu-1', 'completed', 'failure')], run: running },
		{ jobs: [job('e2e / e2e-electron-ubuntu-1', 'completed', 'failure'), job('e2e / e2e-electron-ubuntu-scan-1', 'in_progress')], run: running },
	]);
	const state = fresh();
	await pollOnce(f.deps, state);
	await pollOnce(f.deps, state);
	assert.deepStrictEqual(f.writes.map(w => w.out.status), ['completed']);
});

test('unexpanded template job names never get a status', async () => {
	const f = fake([{
		jobs: [
			job('e2e / ${{ (inputs.display_name || \'e2e-linux\') }}-publish', 'completed', 'skipped'),
			job('e2e / inputs.display_name || \'e2e-linux\'', 'queued'),
			job('unit / vitest', 'in_progress'),
		],
		run: running,
	}]);
	await pollOnce(f.deps, fresh());
	assert.deepStrictEqual(f.writes.map(w => w.name), ['unit / vitest']);
});

test('reads the run before the jobs, so a run that completes in between is judged on the final jobs', async () => {
	const calls: string[] = [];
	const f = fake([{ jobs: [job('unit / vitest', 'in_progress')], run: running }]);
	const { listJobs, getRun } = f.deps;
	f.deps.listJobs = async id => (calls.push('jobs'), listJobs(id));
	f.deps.getRun = async id => (calls.push('run'), getRun(id));
	await pollOnce(f.deps, fresh());
	assert.deepStrictEqual(calls, ['run', 'jobs']);
});

test('poll.ts writes code and conclusion to GITHUB_OUTPUT', () => {
	const out = join(mkdtempSync(join(tmpdir(), 'poll-')), 'output');
	// No RUN_ID: the poll crashes right away, which is code 1 with no conclusion.
	spawnSync(process.execPath, [join(import.meta.dirname, 'poll.ts')], { env: { PATH: process.env.PATH, GITHUB_OUTPUT: out } });
	assert.strictEqual(readFileSync(out, 'utf8'), 'code=1\nconclusion=\n');
});
