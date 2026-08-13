/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { request } from 'undici';
import {
	CONNECT_API_KEY,
	LOCAL_API_URL,
	PROD_API_URL,
	platformOs,
	platformVersion,
	positronVersion
} from '../metrics/metric-base.js';
import { MemoryScenario } from './scenarios.js';
import { MemorySnapshot, ProcessRole } from './types.js';

/**
 * The roles the client knows about. Kept beside the guard below so a role added
 * to `ProcessRole` without being added here fails to compile.
 */
const PROCESS_ROLES: Record<ProcessRole, true> = {
	main: true, renderer: true, gpu: true, network: true, shared: true,
	extension_host: true, pty_host: true, file_watcher: true, agent_host: true,
	kernel_supervisor: true, kernel: true, language_server: true,
	extension_child: true, zygote: true, shell: true, unlabeled: true
};

const isProcessRole = (value: string): value is ProcessRole => value in PROCESS_ROLES;

/**
 * The memory endpoints sit beside the existing metrics ones on the same service,
 * so the host and the PROD/LOCAL split are derived from the shared constants
 * rather than restated. Restating them means a host change fixes metrics and
 * silently leaves memory posting into the void.
 */
const memoryUrl = (base: string): string => base.replace(/\/metrics$/, '/memory');

/**
 * Whether to talk to the insights API at all. Opt in with `MEMORY_PUBLISH=true`.
 *
 * The `/memory` endpoints do not exist yet; they are a follow-up. Until they do,
 * a run should not attempt the call. Failing soft is not sufficient on its own:
 * a POST that errors and a POST to an endpoint nobody has written look identical
 * in the log, so an absent endpoint could sit unnoticed behind a line that reads
 * like ordinary noise.
 *
 * Exactly `'true'`, not any truthy string. A workflow that sets `MEMORY_PUBLISH:
 * 'false'` to document the switch must not thereby turn it on.
 */
export function publishingEnabled(): boolean {
	return process.env.MEMORY_PUBLISH === 'true';
}

export type RunMeta = {
	runId: string;
	commitSha: string;
	branch: string;
	containerImage: string;
};

/**
 * One request per run, carrying every launch. The existing /metrics endpoint
 * takes a row per request, which for memory would let a partially written tree
 * surface as a fake memory drop.
 */
export type MemoryPayload = {
	/**
	 * Wire format version. Bump when a field changes meaning or disappears, so
	 * ingestion can reject or migrate rather than silently mis-parse. The
	 * dashboard plan is written against version 1.
	 */
	payload_version: 1;
	timestamp: string;
	run_id: string;
	branch: string;
	commit_sha: string;
	app_version: string;
	build_number: string;
	platform_os: string;
	platform_version: string;
	container_image: string;
	scenario: MemoryScenario;
	launches: {
		launch_index: number;
		settle_ms: number;
		tree_total_pss_bytes: number;
		processes: {
			pid: number;
			ppid: number;
			depth: number;
			process_name: string;
			process_role: string;
			labeled: boolean;
			cmd_basename: string;
			pss_bytes: number;
			rss_bytes: number;
			pss_min: number;
			pss_max: number;
		}[];
		extensions: {
			extension_id: string;
			is_builtin: boolean;
			activation_time_ms: number | null;
			activation_event: string | null;
		}[];
	}[];
};

function apiUrl(branch: string): string {
	return memoryUrl(branch === 'main' ? PROD_API_URL : LOCAL_API_URL);
}

/**
 * Drop the window title from a process name before publishing.
 *
 * `window [1] (my-project)` carries the workspace name, and in a manually
 * dispatched run that can be anything on the contributor's disk. The title adds
 * nothing to a grouped chart, so the published name keeps only the stable part.
 * The local HTML report still renders the full name.
 */
export function redactProcessName(name: string): string {
	return name.replace(/^(window \[\d+\]).*$/, '$1');
}

export function buildPayload(snapshots: MemorySnapshot[], meta: RunMeta): MemoryPayload {
	// Thrown rather than defaulted. Every other field can degrade to 'unknown' and
	// still leave a usable row, but a payload whose scenario is undefined cannot be
	// attributed to anything, and one silently ingested under a missing key is worse
	// than a run that failed loudly.
	const [first] = snapshots;
	if (first === undefined) {
		throw new Error('cannot build a memory payload from no snapshots');
	}
	return {
		payload_version: 1,
		timestamp: new Date().toISOString(),
		run_id: meta.runId,
		branch: meta.branch,
		commit_sha: meta.commitSha,
		app_version: positronVersion?.positronVersion ?? 'unknown',
		build_number: String(positronVersion?.buildNumber ?? 'unknown'),
		platform_os: platformOs,
		platform_version: platformVersion,
		container_image: meta.containerImage,
		scenario: first.scenario,
		launches: snapshots.map(snapshot => ({
			launch_index: snapshot.launchIndex,
			settle_ms: snapshot.settleMs,
			tree_total_pss_bytes: snapshot.treeTotalPssBytes,
			processes: snapshot.processes.map(p => ({
				pid: p.pid, ppid: p.ppid, depth: p.depth,
				process_name: redactProcessName(p.processName), process_role: p.processRole,
				labeled: p.labeled, cmd_basename: p.cmdBasename,
				pss_bytes: p.pssBytes, rss_bytes: p.rssBytes,
				pss_min: p.pssMin, pss_max: p.pssMax
			})),
			extensions: snapshot.extensions.map(e => ({
				extension_id: e.extensionId,
				is_builtin: e.isBuiltin,
				activation_time_ms: e.activationTimeMs,
				activation_event: e.activationEvent
			}))
		}))
	};
}

/** Returns whether the publish succeeded. Never throws: reports are the point. */
export async function publishSnapshots(snapshots: MemorySnapshot[], meta: RunMeta): Promise<boolean> {
	if (!publishingEnabled()) {
		console.log('[memory] MEMORY_PUBLISH is not true, skipping publish; the report is still rendered and attached');
		return false;
	}
	if (!CONNECT_API_KEY) {
		console.log('[memory] no CONNECT_API_KEY, skipping publish');
		return false;
	}
	try {
		const response = await request(apiUrl(meta.branch), {
			method: 'POST',
			headers: { Authorization: `Key ${CONNECT_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(buildPayload(snapshots, meta))
		});
		// undici will not release the socket until the body is consumed, so drain
		// it even though only the status code matters here.
		await response.body.dump();
		console.log(`[memory] publish responded ${response.statusCode}`);
		return response.statusCode < 400;
	} catch (error) {
		console.error(`[memory] publish failed: ${error}`);
		return false;
	}
}

/**
 * Response shape for `GET /memory/baseline`. This is a contract with the
 * dashboard plan, not an inference from whatever it happens to return.
 *
 *   GET /memory/baseline?scenario=idle&branch=main
 *   Authorization: Key <CONNECT_API_KEY>
 *
 * 200 with `{ "found": false }` when no baseline exists yet. That is a normal
 * first-run state, not an error, and must not be a 404: a 404 is
 * indistinguishable from a typo in the path.
 *
 * 200 with `{ "found": true, "snapshot": {...} }` otherwise, where `snapshot`
 * carries the median launch of the most recent main-branch nightly, using the
 * same field names as one entry of `MemoryPayload.launches` plus the run-level
 * `tree_total_pss_bytes`.
 */
export type BaselineResponse =
	| { found: false }
	| {
		found: true;
		snapshot: {
			tree_total_pss_bytes: number;
			settle_ms: number;
			processes: { process_name: string; process_role: string; pss_bytes: number }[];
			// Optional because an endpoint deployed before this field was read will
			// omit it. The report degrades to an eager count with no newly-eager
			// list rather than treating every extension as newly eager.
			extensions: { extension_id: string; activation_event?: string | null }[];
		};
	};

/**
 * Map a baseline response onto a snapshot. Only the fields the report's delta
 * actually reads are mapped; the rest are filled with neutral values rather than
 * faked, so anything reading further gets an obvious zero instead of a plausible
 * number.
 */
export function baselineToSnapshot(body: BaselineResponse, scenario: MemoryScenario): MemorySnapshot | undefined {
	if (!body.found) {
		return undefined;
	}
	return {
		scenario,
		// Neutral rather than faked, per the note above: the baseline predates this run
		// and the response carries neither field. The report reads neither for the
		// baseline, and '' fails the freshness check loudly if anything ever starts to.
		capturedAt: '',
		positronVersion: '',
		launchIndex: 0,
		settleMs: body.snapshot.settle_ms,
		treeTotalPssBytes: body.snapshot.tree_total_pss_bytes,
		processes: body.snapshot.processes.map(p => ({
			pid: 0, ppid: 0, depth: 0,
			processName: p.process_name,
			// Validated rather than cast. A role added server-side before the client
			// knows it would otherwise become an invalid ProcessRole at runtime and
			// fall through every switch downstream.
			processRole: isProcessRole(p.process_role) ? p.process_role : 'unlabeled',
			labeled: true, cmdBasename: '',
			pssBytes: p.pss_bytes, rssBytes: 0, pssMin: p.pss_bytes, pssMax: p.pss_bytes,
			// One sample, because the response carries one figure per process. That
			// also keeps a baseline out of the unstable-process report: a single
			// sample cannot be judged unstable.
			pssSamples: [p.pss_bytes], rssSamples: [0]
		})),
		extensions: body.snapshot.extensions.map(e => ({
			extensionId: e.extension_id, isBuiltin: false,
			activationTimeMs: null, activationEvent: e.activation_event ?? null
		}))
	};
}

/**
 * Most recent main-branch nightly, used for the delta in the run report.
 * Undefined when there is no baseline yet or the endpoint is unavailable, in
 * which case the report shows absolute numbers only.
 */
export async function fetchBaseline(scenario: MemoryScenario): Promise<MemorySnapshot | undefined> {
	if (!publishingEnabled() || !CONNECT_API_KEY) {
		return undefined;
	}
	try {
		const response = await request(`${memoryUrl(PROD_API_URL)}/baseline?scenario=${scenario}&branch=main`, {
			method: 'GET',
			headers: { Authorization: `Key ${CONNECT_API_KEY}` }
		});
		if (response.statusCode >= 400) {
			return undefined;
		}
		return baselineToSnapshot(await response.body.json() as BaselineResponse, scenario);
	} catch (error) {
		console.error(`[memory] could not fetch baseline: ${error}`);
		return undefined;
	}
}
