/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createCheck, getRun, listJobs, updateCheck } from './github.ts';
import { groupLanes, type Job } from './lanes.ts';
import { renderLane, renderUnreadable, type CheckOutput } from './render.ts';

/** What survives between poll halves and into finalize. */
export type State = {
	checks: Record<string, { id: number; out: CheckOutput; closed: boolean }>;
	readErrors: number;
};

/** The GitHub calls with their tokens bound, so tests pass fakes. */
export type Deps = {
	runId: string;
	headSha: string;
	runUrl: string;
	listJobs: (runId: string) => Promise<Job[]>;
	getRun: (runId: string) => Promise<{ status: string; conclusion: string | null }>;
	createCheck: (sha: string, name: string, out: CheckOutput) => Promise<number>;
	updateCheck: (id: number, out: CheckOutput) => Promise<void>;
};

const READ_ERRORS_LIMIT = 3;
const POLL_SECONDS = 60;

/**
 * Creates the lane's check, or updates it if the output changed. Writing is
 * best effort: a failure leaves the state alone so the next call retries.
 */
export async function publish(deps: Deps, state: State, lane: string, out: CheckOutput): Promise<void> {
	const known = state.checks[lane];
	if (known && JSON.stringify(known.out) === JSON.stringify(out)) {
		return;
	}
	try {
		const id = known ? known.id : await deps.createCheck(deps.headSha, lane, out);
		if (known) {
			await deps.updateCheck(id, out);
		}
		state.checks[lane] = { id, out, closed: out.status === 'completed' };
	} catch (e) {
		console.log(`Could not write the check for a lane: ${(e as Error).message}`);
	}
}

/** Closes every check that is still open. */
export async function closeOpen(deps: Deps, state: State, reason: 'unreadable' | 'timed_out' | 'cancelled'): Promise<void> {
	const out = renderUnreadable(deps.runUrl, reason);
	for (const [lane, check] of Object.entries(state.checks)) {
		if (!check.closed) {
			await publish(deps, state, lane, out);
		}
	}
}

/**
 * One poll: reads the run's jobs, writes each lane's check, and says whether
 * the run is done. Results files are not available yet, so lanes render
 * without them. Three failed reads in a row end the poll as a failure.
 */
export async function pollOnce(deps: Deps, state: State): Promise<{ done: boolean; conclusion: string | null }> {
	let jobs: Job[];
	let run: { status: string; conclusion: string | null };
	try {
		jobs = await deps.listJobs(deps.runId);
		run = await deps.getRun(deps.runId);
	} catch (e) {
		state.readErrors++;
		console.log(`Could not read the run (${state.readErrors} in a row): ${(e as Error).message}`);
		if (state.readErrors >= READ_ERRORS_LIMIT) {
			await closeOpen(deps, state, 'unreadable');
			return { done: true, conclusion: 'failure' };
		}
		return { done: false, conclusion: null };
	}
	state.readErrors = 0;
	for (const lane of groupLanes(jobs)) {
		await publish(deps, state, lane.name, renderLane(lane, deps.runUrl, null, null));
	}
	return run.status === 'completed' ? { done: true, conclusion: run.conclusion } : { done: false, conclusion: null };
}

/** Reads the state file, or starts empty if it is missing or unreadable. */
export function loadState(file: string): State {
	try {
		const s = JSON.parse(readFileSync(file, 'utf8')) as State;
		return { checks: s.checks ?? {}, readErrors: s.readErrors ?? 0 };
	} catch {
		return { checks: {}, readErrors: 0 };
	}
}

export function saveState(file: string, state: State): void {
	writeFileSync(file, JSON.stringify(state));
}

/** Binds the tokens and run details from the environment. */
export function depsFromEnv(env: NodeJS.ProcessEnv): Deps {
	const need = (k: string): string => {
		const v = env[k];
		if (!v) {
			throw new Error(`${k} is not set`);
		}
		return v;
	};
	const builds = need('BUILDS_TOKEN');
	const checks = need('CHECKS_TOKEN');
	const runId = need('RUN_ID');
	return {
		runId,
		headSha: need('HEAD_SHA'),
		runUrl: `https://github.com/posit-dev/positron-builds/actions/runs/${runId}`,
		listJobs: id => listJobs(builds, id),
		getRun: id => getRun(builds, id),
		createCheck: (sha, name, out) => createCheck(checks, sha, name, out),
		updateCheck: (id, out) => updateCheck(checks, id, out),
	};
}

async function main(): Promise<void> {
	const deps = depsFromEnv(process.env);
	const stateFile = process.env.STATE_FILE ?? 'pr-test-status-state.json';
	const deadline = Date.now() + Number(process.env.DEADLINE_SECONDS ?? '3300') * 1000;
	const state = loadState(stateFile);
	let code = 124;
	while (true) {
		const res = await pollOnce(deps, state);
		saveState(stateFile, state);
		if (res.done) {
			code = res.conclusion === 'success' ? 0 : 1;
			break;
		}
		if (Date.now() >= deadline) {
			break;
		}
		await new Promise(r => setTimeout(r, Math.min(POLL_SECONDS * 1000, Math.max(0, deadline - Date.now()))));
	}
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `code=${code}\n`);
	}
}

if (import.meta.main) {
	await main();
}
