/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeOpen, depsFromEnv, loadState, publish, saveState, type Deps, type State } from './poll.ts';
import { groupLanes, type Job } from './lanes.ts';
import { renderLane, renderRequiredSummary } from './render.ts';
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

/** What finalize does: write final results, or close open checks. */
export type Mode = 'final' | 'cancel' | 'timeout';

/** Reads MODE: one of the three known values, or an error. */
export function parseMode(raw: string | undefined): Mode {
	if (raw === 'final' || raw === 'cancel' || raw === 'timeout') {
		return raw;
	}
	throw new Error('MODE must be final, cancel or timeout');
}

/**
 * Writes each lane's final check, or closes open checks for cancel and
 * timeout. Whatever is still open at the end is closed as unreadable, so no
 * check stays in progress. Returns the step summary text, or null.
 */
export async function finalize(deps: Deps, state: State, mode: Mode, resultsDir: string): Promise<string | null> {
	if (mode === 'timeout' || mode === 'cancel') {
		await closeOpen(deps, state, mode === 'timeout' ? 'timed_out' : 'cancelled');
		return null;
	}
	let jobs: Job[];
	try {
		jobs = await deps.listJobs(deps.runId);
	} catch (e) {
		console.log(`Could not read the run: ${(e as Error).message}`);
		await closeOpen(deps, state, 'unreadable');
		return renderRequiredSummary([], deps.runUrl);
	}
	const artifacts = readArtifacts(resultsDir);
	const lanes = groupLanes(jobs);
	// Second pass retries any write that failed.
	for (let pass = 0; pass < 2; pass++) {
		for (const lane of lanes) {
			const out = renderLane(lane, deps.runUrl, artifacts.results.get(lane.name) ?? null, artifacts.cache.get(lane.name) ?? null);
			await publish(deps, state, lane.name, out);
		}
	}
	await closeOpen(deps, state, 'unreadable');
	return renderRequiredSummary(jobs, deps.runUrl);
}

async function main(): Promise<void> {
	const deps = depsFromEnv(process.env);
	const stateFile = process.env.STATE_FILE ?? 'pr-test-status-state.json';
	const mode = parseMode(process.env.MODE);
	const state = loadState(stateFile);
	const summary = await finalize(deps, state, mode, process.env.RESULTS_DIR ?? 'results');
	saveState(stateFile, state);
	if (summary !== null && process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
	}
}

if (import.meta.main) {
	await main();
}
