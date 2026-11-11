/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync } from 'node:fs';
import { closeOpen, depsFromEnv, loadState, publish, saveState, type Deps, type State } from './statuses.ts';
import { groupLanes, type Lane } from './lanes.ts';
import { laneUrl, renderLane } from './render.ts';

const READ_ERRORS_LIMIT = 3;
const POLL_SECONDS = 60;

/**
 * One poll: reads the run's jobs, writes each lane's status, and says whether
 * the run is done. Results files are not available yet, so lanes render
 * without them. Three failed reads in a row end the poll as a failure.
 */
export async function pollOnce(deps: Deps, state: State): Promise<{ done: boolean; conclusion: string | null }> {
	let run: { status: string; conclusion: string | null };
	let lanes: Lane[];
	try {
		// Read the run first: a run that completes between the reads must not be judged on an older job list.
		run = await deps.getRun(deps.runId);
		lanes = groupLanes(await deps.listJobs(deps.runId), run.status === 'completed');
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
	for (const lane of lanes) {
		await publish(deps, state, lane.name, renderLane(lane, null, null), laneUrl(lane, deps.runUrl));
	}
	return run.status === 'completed' ? { done: true, conclusion: run.conclusion } : { done: false, conclusion: null };
}

/** Reads DEADLINE_SECONDS: a finite number above zero, or an error. */
export function parseDeadline(raw: string | undefined): number {
	const n = Number(raw ?? '3300');
	if (!Number.isFinite(n) || n <= 0) {
		throw new Error('DEADLINE_SECONDS must be a number above zero');
	}
	return n;
}

function writeCode(code: number, conclusion: string): void {
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `code=${code}\nconclusion=${conclusion}\n`);
	}
}

async function main(): Promise<void> {
	// Any crash counts as a failed read of the run: code 1.
	let code = 1;
	let conclusion = '';
	try {
		const deps = depsFromEnv(process.env);
		const stateFile = process.env.STATE_FILE ?? 'pr-test-status-state.json';
		const deadline = Date.now() + parseDeadline(process.env.DEADLINE_SECONDS) * 1000;
		const state = loadState(stateFile);
		code = 124;
		while (true) {
			const res = await pollOnce(deps, state);
			saveState(stateFile, state);
			if (res.done) {
				code = res.conclusion === 'success' ? 0 : 1;
				conclusion = res.conclusion ?? '';
				break;
			}
			if (Date.now() >= deadline) {
				break;
			}
			await new Promise(r => setTimeout(r, Math.min(POLL_SECONDS * 1000, Math.max(0, deadline - Date.now()))));
		}
	} catch (e) {
		code = 1;
		console.log(`Polling stopped: ${(e as Error).message}`);
	}
	writeCode(code, conclusion);
}

if (import.meta.main) {
	await main();
}
