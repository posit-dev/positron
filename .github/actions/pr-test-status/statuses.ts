/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getRun, listJobs, setStatus } from './github.ts';
import type { Job } from './lanes.ts';
import { renderUnreadable, type LaneOutput } from './render.ts';

/** What survives between poll halves and into finalize. */
export type State = {
	statuses: Record<string, { out: LaneOutput; url: string; closed: boolean }>;
	readErrors: number;
};

/** The GitHub calls with their tokens bound, so tests pass fakes. */
export type Deps = {
	runId: string;
	headSha: string;
	runUrl: string;
	listJobs: (runId: string) => Promise<Job[]>;
	getRun: (runId: string) => Promise<{ status: string; conclusion: string | null }>;
	setStatus: (sha: string, lane: string, out: LaneOutput, url: string) => Promise<void>;
};

/**
 * Sets the lane's status if its output or link changed. Writing is best
 * effort: a failure leaves the state alone so the next call retries.
 */
export async function publish(deps: Deps, state: State, lane: string, out: LaneOutput, url: string): Promise<void> {
	const known = state.statuses[lane];
	// A status shows only the state, title and link, so a change to the summary alone is not written.
	if (known && known.url === url && known.out.status === out.status && known.out.conclusion === out.conclusion && known.out.title === out.title) {
		return;
	}
	// Never reopen a closed lane: a failed lane can gain jobs (scan, merge) that start later.
	if (known?.closed && out.status === 'in_progress') {
		return;
	}
	try {
		await deps.setStatus(deps.headSha, lane, out, url);
		state.statuses[lane] = { out, url, closed: out.status === 'completed' };
	} catch (e) {
		console.log(`Could not write the status for a lane: ${(e as Error).message}`);
	}
}

/** Closes every lane that is still open, linking to the builds run. */
export async function closeOpen(deps: Deps, state: State, reason: 'unreadable' | 'timed_out' | 'cancelled'): Promise<void> {
	const out = renderUnreadable(reason);
	for (const [lane, status] of Object.entries(state.statuses)) {
		if (!status.closed) {
			await publish(deps, state, lane, out, deps.runUrl);
		}
	}
}

/** Reads the state file, or starts empty if it is missing or unreadable. */
export function loadState(file: string): State {
	try {
		const s = JSON.parse(readFileSync(file, 'utf8')) as State;
		return { statuses: s.statuses ?? {}, readErrors: s.readErrors ?? 0 };
	} catch {
		return { statuses: {}, readErrors: 0 };
	}
}

/** Writes the state file, creating its folder if needed. */
export function saveState(file: string, state: State): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(state));
}

/**
 * Binds the tokens and run details from the environment. STATUS_TOKEN is
 * optional: without it, status writes are skipped so tests never depend on it.
 */
export function depsFromEnv(env: NodeJS.ProcessEnv): Deps {
	const need = (k: string): string => {
		const v = env[k];
		if (!v) {
			throw new Error(`${k} is not set`);
		}
		return v;
	};
	// finalize runs without the builds token too, so it can still close open lanes.
	const builds = env.MODE === undefined ? need('BUILDS_TOKEN') : env.BUILDS_TOKEN ?? '';
	const noToken = async (): Promise<never> => {
		throw new Error('BUILDS_TOKEN is not set');
	};
	const token = env.STATUS_TOKEN;
	const runId = need('RUN_ID');
	if (!/^\d+$/.test(runId)) {
		throw new Error('RUN_ID must be all digits');
	}
	let warned = false;
	return {
		runId,
		headSha: need('HEAD_SHA'),
		runUrl: `https://github.com/posit-dev/positron-builds/actions/runs/${runId}`,
		listJobs: id => builds ? listJobs(builds, id) : noToken(),
		getRun: id => builds ? getRun(builds, id) : noToken(),
		setStatus: async (sha, lane, out, url) => {
			if (!token) {
				if (!warned) {
					warned = true;
					console.log('STATUS_TOKEN is not set: skipping status writes');
				}
				return;
			}
			await setStatus(token, sha, lane, out, url);
		},
	};
}
