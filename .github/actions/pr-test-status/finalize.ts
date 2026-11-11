/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeOpen, depsFromEnv, loadState, publish, saveState } from './poll.ts';
import { groupLanes } from './lanes.ts';
import { renderLane, renderRequiredSummary } from './render.ts';
import { parseCache, parsePlaywright, parseVitest, type CacheEntry, type Results } from './results.ts';

type Artifacts = { results: Map<string, Results | null>; cache: Map<string, CacheEntry[] | null> };

const readText = (file: string): string | null => existsSync(file) ? readFileSync(file, 'utf8') : null;

/** Maps artifact folders to lane names: `e2e-results-X` to `e2e / X`, `vitest-results`, `unit-cache`. */
function readArtifacts(dir: string): Artifacts {
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

async function main(): Promise<void> {
	const deps = depsFromEnv(process.env);
	const stateFile = process.env.STATE_FILE ?? 'pr-test-status-state.json';
	const mode = process.env.MODE ?? 'final';
	const state = loadState(stateFile);
	if (mode === 'timeout' || mode === 'cancel') {
		await closeOpen(deps, state, mode === 'timeout' ? 'timed_out' : 'cancelled');
		saveState(stateFile, state);
		return;
	}
	const jobs = await deps.listJobs(deps.runId);
	const artifacts = readArtifacts(process.env.RESULTS_DIR ?? 'results');
	for (const lane of groupLanes(jobs)) {
		const out = renderLane(lane, deps.runUrl, artifacts.results.get(lane.name) ?? null, artifacts.cache.get(lane.name) ?? null);
		await publish(deps, state, lane.name, out);
	}
	saveState(stateFile, state);
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderRequiredSummary(jobs, deps.runUrl));
	}
}

await main();
