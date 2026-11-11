/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync, writeFileSync } from 'node:fs';
import { createCheck, getRun, listJobs, updateCheck } from './github.ts';
import type { Job } from './lanes.ts';
import { renderUnreadable, type CheckOutput } from './render.ts';

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

/**
 * Creates the lane's check, or updates it if the output changed. Writing is
 * best effort: a failure leaves the state alone so the next call retries.
 */
export async function publish(deps: Deps, state: State, lane: string, out: CheckOutput): Promise<void> {
	const known = state.checks[lane];
	if (known && JSON.stringify(known.out) === JSON.stringify(out)) {
		return;
	}
	// Never reopen a closed check: a failed lane can gain jobs (scan, merge) that start later.
	if (known?.closed && out.status === 'in_progress') {
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

/** Reads the state file, or starts empty if it is missing or unreadable. */
export function loadState(file: string): State {
	try {
		const s = JSON.parse(readFileSync(file, 'utf8')) as State;
		return { checks: s.checks ?? {}, readErrors: s.readErrors ?? 0 };
	} catch {
		return { checks: {}, readErrors: 0 };
	}
}

/** Writes the state file. */
export function saveState(file: string, state: State): void {
	writeFileSync(file, JSON.stringify(state));
}

/**
 * Binds the tokens and run details from the environment. CHECKS_TOKEN is
 * optional: without it, check writes are skipped so tests never depend on it.
 */
export function depsFromEnv(env: NodeJS.ProcessEnv): Deps {
	const need = (k: string): string => {
		const v = env[k];
		if (!v) {
			throw new Error(`${k} is not set`);
		}
		return v;
	};
	// cancel and timeout only write checks, so they never read the builds run.
	const reads = env.MODE !== 'cancel' && env.MODE !== 'timeout';
	const builds = reads ? need('BUILDS_TOKEN') : env.BUILDS_TOKEN ?? '';
	const checks = env.CHECKS_TOKEN;
	const runId = need('RUN_ID');
	if (!/^\d+$/.test(runId)) {
		throw new Error('RUN_ID must be all digits');
	}
	let warned = false;
	const skip = (): void => {
		if (!warned) {
			warned = true;
			console.log('CHECKS_TOKEN is not set: skipping check writes');
		}
	};
	return {
		runId,
		headSha: need('HEAD_SHA'),
		runUrl: `https://github.com/posit-dev/positron-builds/actions/runs/${runId}`,
		listJobs: id => listJobs(builds, id),
		getRun: id => getRun(builds, id),
		createCheck: async (sha, name, out) => {
			if (!checks) {
				skip();
				return 0;
			}
			return createCheck(checks, sha, name, out);
		},
		updateCheck: async (id, out) => {
			if (!checks) {
				skip();
				return;
			}
			await updateCheck(checks, id, out);
		},
	};
}
