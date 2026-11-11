/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeOpen, depsFromEnv, loadState, publish, saveState, type Deps, type State } from './statuses.ts';
import { groupLanes, type Job } from './lanes.ts';
import { laneUrl, renderLane, renderLanes, renderRequiredSummary } from './render.ts';
import { parseCache, parsePlaywright, parseVitest, type CacheEntry, type Results } from './results.ts';

/** Parsed artifacts by lane name. */
type Artifacts = { results: Map<string, Results | null>; cache: Map<string, CacheEntry[] | null> };

const readText = (file: string): string | null => existsSync(file) ? readFileSync(file, 'utf8') : null;

/** Maps artifact folders to lane names: `e2e-results-X` to `e2e / X`, `vitest-results`, `unit-cache`. */
export function readArtifacts(dir: string): Artifacts {
	const out: Artifacts = { results: new Map(), cache: new Map() };
	let names: string[] = [];
	try {
		names = readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of names) {
		try {
			if (name.startsWith('e2e-results-')) {
				const raw = readText(join(dir, name, 'results.json'));
				out.results.set(`e2e / ${name.slice('e2e-results-'.length)}`, raw === null ? null : parsePlaywright(raw));
			} else if (name === 'vitest-results') {
				const raw = readText(join(dir, name, 'results.json'));
				out.results.set('unit / vitest', raw === null ? null : parseVitest(raw));
			} else if (name === 'unit-cache') {
				const raw = readText(join(dir, name, 'cache.json'));
				out.cache.set('unit / vscode', raw === null ? null : parseCache(raw));
			}
		} catch {
			// An unreadable file counts as missing.
		}
	}
	return out;
}

/** What finalize does: write final results, or close open lanes. */
export type Mode = 'final' | 'cancel' | 'timeout';

/** Reads MODE: one of the three known values, or an error. */
export function parseMode(raw: string | undefined): Mode {
	if (raw === 'final' || raw === 'cancel' || raw === 'timeout') {
		return raw;
	}
	throw new Error('MODE must be final, cancel or timeout');
}

/** The builds run's status, retrying a failed read once; null if both reads fail. */
async function readRunStatus(deps: Deps): Promise<string | null> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			return (await deps.getRun(deps.runId)).status;
		} catch (e) {
			console.log(`Could not read the run status: ${(e as Error).message}`);
		}
	}
	return null;
}

/**
 * Writes each lane's final status, or closes open lanes for cancel and
 * timeout. Whatever is still open at the end is closed as unreadable, so no
 * lane stays pending. Returns the step summary text (the lane table and
 * details), or null.
 */
export async function finalize(deps: Deps, state: State, mode: Mode, resultsDir: string): Promise<string | null> {
	if (mode === 'timeout' || mode === 'cancel') {
		await closeOpen(deps, state, mode === 'timeout' ? 'timed_out' : 'cancelled');
		return null;
	}
	// Read the run before the jobs, so a run that completes in between is not judged on an older job list.
	const runStatus = await readRunStatus(deps);
	const runCompleted = runStatus === 'completed';
	let jobs: Job[];
	try {
		jobs = await deps.listJobs(deps.runId);
	} catch (e) {
		console.log(`Could not read the run: ${(e as Error).message}`);
		await closeOpen(deps, state, 'unreadable');
		return renderRequiredSummary([]);
	}
	const artifacts = readArtifacts(resultsDir);
	// final also runs after the poll gave up early: lanes still running are closed below, not set pending.
	const lanes = groupLanes(jobs, runCompleted).filter(lane => lane.state !== 'in_progress').map(lane => ({
		lane,
		out: renderLane(lane, artifacts.results.get(lane.name) ?? null, artifacts.cache.get(lane.name) ?? null),
	}));
	// Second pass retries any write that failed.
	for (let pass = 0; pass < 2; pass++) {
		for (const { lane, out } of lanes) {
			await publish(deps, state, lane.name, out, laneUrl(lane, deps.runUrl));
		}
	}
	await closeOpen(deps, state, runStatus === null || runCompleted ? 'unreadable' : 'timed_out');
	return (lanes.length > 0 ? renderLanes(lanes, deps.runUrl) + '\n' : '') + renderRequiredSummary(jobs);
}

async function main(): Promise<void> {
	const deps = depsFromEnv(process.env);
	const stateFile = process.env.STATE_FILE ?? 'pr-test-status-state.json';
	const mode = parseMode(process.env.MODE);
	const state = loadState(stateFile);
	const summary = await finalize(deps, state, mode, process.env.RESULTS_DIR ?? 'results');
	if (summary !== null && process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
	}
	saveState(stateFile, state);
}

if (import.meta.main) {
	await main();
}
