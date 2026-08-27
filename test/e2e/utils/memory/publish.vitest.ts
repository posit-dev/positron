/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BaselineResponse, baselineQuery, baselineToSnapshot, buildPayload, containerImageFromEnv, fetchBaseline, publishingEnabled, publishSnapshots, publishTargetIsProduction, redactProcessName, RunMeta } from './publish.js';
import { LabeledProcess, MemorySnapshot } from './types.js';

vi.mock('undici', () => ({
	request: vi.fn()
}));

vi.mock('../metrics/metric-base.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../metrics/metric-base.js')>();
	return {
		...actual,
		CONNECT_API_KEY: 'fake-key-for-testing',
		LOCAL_API_URL: 'http://localhost:3000/metrics',
		PROD_API_URL: 'https://api.example.com/metrics'
	};
});

const process1: LabeledProcess = {
	pid: 100, ppid: 1, depth: 0,
	processName: 'window [1] (secret-client-project)',
	processRole: 'renderer', labeled: true, cmdBasename: 'positron',
	pssBytes: 300, rssBytes: 600, pssMin: 290, pssMax: 310,
	forcedGc: false
};

const snapshot: MemorySnapshot = {
	scenario: 'idle',
	lane: 'desktop',
	capturedAt: '2026-08-11T00:00:00.000Z',
	positronVersion: '2026.09.0-35',
	launchIndex: 2,
	settleMs: 4200,
	treeTotalPssBytes: 300,
	processes: [process1],
	extensions: [{ extensionId: 'positron.positron-r', isBuiltin: true, activationTimeMs: null, activationEvent: 'onStartupFinished' }]
};

const meta: RunMeta = {
	runId: '123',
	commitSha: 'abc123',
	branch: 'mi/mem-usage',
	containerImage: 'ghcr.io/posit-dev/positron-ci:latest'
};

describe('containerImageFromEnv', () => {
	afterEach(() => { delete process.env.MEMORY_CONTAINER_IMAGE; });

	test('falls back to unknown when unset', () => {
		delete process.env.MEMORY_CONTAINER_IMAGE;
		expect(containerImageFromEnv()).toBe('unknown');
	});

	test('reads MEMORY_CONTAINER_IMAGE when set', () => {
		process.env.MEMORY_CONTAINER_IMAGE = 'ghcr.io/posit-dev/positron-ubuntu24:24.18.0';
		expect(containerImageFromEnv()).toBe('ghcr.io/posit-dev/positron-ubuntu24:24.18.0');
	});
});

describe('redactProcessName', () => {
	test('drops the workspace title from a window name', () => {
		expect(redactProcessName('window [1] (secret-client-project)')).toBe('window [1]');
	});

	test('keeps the window index, which distinguishes windows', () => {
		expect(redactProcessName('window [2] (other)')).toBe('window [2]');
	});

	test('leaves names that carry no title alone', () => {
		expect(redactProcessName('extension-host [1]')).toBe('extension-host [1]');
		expect(redactProcessName('gpu-process')).toBe('gpu-process');
	});
});

describe('buildPayload', () => {
	// A payload with no scenario is unattributable: ingestion cannot tell which
	// scenario the launches belong to, so it is worse than no payload at all.
	test('refuses to build a payload from no snapshots', () => {
		expect(() => buildPayload([], meta)).toThrow(/no snapshots/i);
	});

	test('pins the payload version the dashboard plan is written against', () => {
		expect(buildPayload([snapshot], meta).payload_version).toBe(1);
	});

	test('carries run metadata and one entry per launch', () => {
		const payload = buildPayload([snapshot, { ...snapshot, launchIndex: 3 }], meta);
		expect(payload.run_id).toBe('123');
		expect(payload.commit_sha).toBe('abc123');
		expect(payload.branch).toBe('mi/mem-usage');
		expect(payload.container_image).toBe('ghcr.io/posit-dev/positron-ci:latest');
		expect(payload.launches.map(l => l.launch_index)).toEqual([2, 3]);
	});

	test('converts every process field to snake_case', () => {
		const [launch] = buildPayload([snapshot], meta).launches;
		expect(launch.processes[0]).toEqual({
			pid: 100, ppid: 1, depth: 0,
			process_name: 'window [1]', process_role: 'renderer',
			labeled: true, cmd_basename: 'positron',
			pss_bytes: 300, rss_bytes: 600, pss_min: 290, pss_max: 310
		});
	});

	test('redacts window titles on the way out', () => {
		const payload = buildPayload([snapshot], meta);
		expect(JSON.stringify(payload)).not.toContain('secret-client-project');
	});

	test('carries the extension inventory', () => {
		const [launch] = buildPayload([snapshot], meta).launches;
		expect(launch.extensions).toEqual([{
			extension_id: 'positron.positron-r',
			is_builtin: true,
			activation_time_ms: null,
			activation_event: 'onStartupFinished'
		}]);
	});

	test('reports the platform rather than hard-coding Linux', () => {
		const payload = buildPayload([snapshot], meta);
		// platform_version is the kernel release, not the platform name, which is
		// what distinguishes two container images running the same OS.
		expect(payload.platform_os).toMatch(/^(Linux|macOS|Windows)$/);
		expect(payload.platform_version).not.toBe(payload.platform_os);
		expect(payload.platform_version.length).toBeGreaterThan(0);
	});

	test('carries the snapshot scenario rather than assuming idle', () => {
		const payload = buildPayload([{ ...snapshot, scenario: 'session-r' }], meta);
		expect(payload.scenario).toBe('session-r');
	});
});

// Common provenance fields every found:true BaselineResponse now requires.
// Nothing has ever published to this endpoint, so these are not defensive
// optionals to preserve compatibility with a shape that was never released.
const baselineProvenance = {
	container_image: 'img', run_id: 'r', app_version: 'v', lane: 'desktop'
} as const;

describe('baselineToSnapshot', () => {
	test('returns undefined on a first run, when no baseline exists yet', () => {
		expect(baselineToSnapshot({ found: false, reason: 'no_baseline' }, 'idle')).toBeUndefined();
	});

	test('maps the fields the report delta reads', () => {
		const mapped = baselineToSnapshot({
			found: true,
			...baselineProvenance,
			snapshot: {
				tree_total_pss_bytes: 1000,
				settle_ms: 5000,
				processes: [{ process_name: 'gpu-process', process_role: 'gpu', pss_bytes: 40 }],
				extensions: [{ extension_id: 'vscode.git', activation_event: null }]
			}
		}, 'idle');
		expect(mapped?.treeTotalPssBytes).toBe(1000);
		expect(mapped?.settleMs).toBe(5000);
		expect(mapped?.processes[0].processName).toBe('gpu-process');
		expect(mapped?.processes[0].pssBytes).toBe(40);
		expect(mapped?.extensions[0].extensionId).toBe('vscode.git');
	});

	test('falls back to unlabeled for a role the client does not know', () => {
		// The API gaining a role before the client does must not produce a
		// ProcessRole value that no downstream switch handles.
		const mapped = baselineToSnapshot({
			found: true,
			...baselineProvenance,
			snapshot: {
				tree_total_pss_bytes: 1000, settle_ms: 5000,
				processes: [{ process_name: 'something-new', process_role: 'quantum_host', pss_bytes: 40 }],
				extensions: []
			}
		}, 'idle');
		expect(mapped?.processes[0].processRole).toBe('unlabeled');
	});

	test('keeps a role the client does know', () => {
		const mapped = baselineToSnapshot({
			found: true,
			...baselineProvenance,
			snapshot: {
				tree_total_pss_bytes: 1000, settle_ms: 5000,
				processes: [{ process_name: 'ark', process_role: 'kernel', pss_bytes: 40 }],
				extensions: []
			}
		}, 'idle');
		expect(mapped?.processes[0].processRole).toBe('kernel');
	});

	test('fills unmapped numbers with zero rather than plausible values', () => {
		const mapped = baselineToSnapshot({
			found: true,
			...baselineProvenance,
			snapshot: {
				tree_total_pss_bytes: 1000, settle_ms: 5000,
				processes: [{ process_name: 'gpu-process', process_role: 'gpu', pss_bytes: 40 }],
				extensions: []
			}
		}, 'idle');
		expect(mapped?.processes[0].pid).toBe(0);
		expect(mapped?.processes[0].rssBytes).toBe(0);
	});
});

describe('baselineToSnapshot lane', () => {
	test('rejects a response whose lane is not a known member rather than defaulting to desktop', () => {
		// A server baseline mislabeled desktop (or vice versa) is exactly the
		// cross-lane contamination the lane dimension exists to prevent, so an
		// unrecognized lane must not be coerced into a plausible-looking default.
		const body = {
			found: true, container_image: 'img', run_id: 'r', app_version: 'v', lane: 'workbench',
			snapshot: { tree_total_pss_bytes: 1000, settle_ms: 5000, processes: [], extensions: [] }
		} as unknown as BaselineResponse;
		expect(baselineToSnapshot(body, 'idle')).toBeUndefined();
	});

	test('carries the lane from the response rather than a hardcoded desktop', () => {
		const body = {
			found: true, container_image: 'img', run_id: 'r', app_version: 'v', lane: 'server',
			snapshot: { tree_total_pss_bytes: 1000, settle_ms: 5000, processes: [], extensions: [] }
		} as BaselineResponse;
		expect(baselineToSnapshot(body, 'idle')?.lane).toBe('server');
	});
});

describe('baselineToSnapshot activation_event', () => {
	test('coerces a non-string to null rather than passing it through', () => {
		// The API briefly serialized null as {}. Truthy, so `?? null` kept it, and
		// it inverted the baselineKnowsEvents guard in render.ts so every eager
		// extension read as newly eager. Validate, do not cast: the same function
		// already does this for process_role.
		const body = {
			found: true, container_image: 'img', run_id: 'r', app_version: 'v', lane: 'desktop',
			snapshot: {
				tree_total_pss_bytes: 1, settle_ms: 1, processes: [],
				extensions: [{ extension_id: 'a.b', activation_event: {} as unknown as string }]
			}
		} as BaselineResponse;
		const snapshot = baselineToSnapshot(body, 'idle');
		expect(snapshot?.extensions[0].activationEvent).toBeNull();
	});

	test('keeps a real activation event', () => {
		const body = {
			found: true, container_image: 'img', run_id: 'r', app_version: 'v', lane: 'desktop',
			snapshot: {
				tree_total_pss_bytes: 1, settle_ms: 1, processes: [],
				extensions: [{ extension_id: 'a.b', activation_event: 'onStartupFinished' }]
			}
		} as BaselineResponse;
		expect(baselineToSnapshot(body, 'idle')?.extensions[0].activationEvent).toBe('onStartupFinished');
	});
});

describe('baseline query', () => {
	test('sends lane and container_image', () => {
		expect(baselineQuery('idle', 'server', 'ghcr.io/x:1'))
			.toBe('?scenario=idle&branch=main&lane=server&container_image=ghcr.io%2Fx%3A1');
	});
});

describe('publishingEnabled', () => {
	afterEach(() => { delete process.env.MEMORY_PUBLISH; });

	test('is off unless explicitly turned on', () => {
		// Off by default keeps a local or manually driven run out of the dataset:
		// only the workflow opts in, and only main's runs reach production.
		delete process.env.MEMORY_PUBLISH;
		expect(publishingEnabled()).toBe(false);
	});

	test('stays off for any value that is not exactly true', () => {
		process.env.MEMORY_PUBLISH = '1';
		expect(publishingEnabled()).toBe(false);
		process.env.MEMORY_PUBLISH = 'yes';
		expect(publishingEnabled()).toBe(false);
	});

	test('turns on for true', () => {
		process.env.MEMORY_PUBLISH = 'true';
		expect(publishingEnabled()).toBe(true);
	});

	test('publishSnapshots reports failure rather than pretending it published', async () => {
		delete process.env.MEMORY_PUBLISH;
		const published = await publishSnapshots([], {
			runId: 'r', commitSha: 'c', branch: 'main', containerImage: 'i'
		});
		expect(published).toBe(false);
	});

	test('fetchBaseline yields no baseline, so the report shows absolute numbers', async () => {
		delete process.env.MEMORY_PUBLISH;
		expect(await fetchBaseline('idle', 'desktop')).toBeUndefined();
	});
});

describe('publishTargetIsProduction', () => {
	// The spec fails a run whose POST failed, but only where a POST was meant to
	// land. If this ever answered true for a branch, every branch dispatch would
	// fail on an endpoint nobody is running; if it answered false for main, a
	// nightly could publish nothing and still pass.
	test('is true only for main', () => {
		expect(publishTargetIsProduction('main')).toBe(true);
		expect(publishTargetIsProduction('midleman/some-branch')).toBe(false);
		expect(publishTargetIsProduction('local')).toBe(false);
		expect(publishTargetIsProduction('release/2026.09')).toBe(false);
	});
});

describe('fetchBaseline lane mismatch', () => {
	const foundBody: BaselineResponse = {
		found: true,
		container_image: 'ghcr.io/posit-dev/positron-ci:latest',
		run_id: 'r',
		app_version: '2026.09.0-35',
		lane: 'desktop',
		snapshot: {
			tree_total_pss_bytes: 1000,
			settle_ms: 100,
			processes: [],
			extensions: []
		}
	};

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.MEMORY_PUBLISH = 'true';
	});

	afterEach(() => {
		delete process.env.MEMORY_PUBLISH;
	});

	async function mockResponse(statusCode: number, body: unknown) {
		const { request } = await import('undici');
		vi.mocked(request).mockResolvedValue({
			statusCode,
			body: {
				json: async () => body,
				text: async () => JSON.stringify(body),
				dump: async () => { }
			}
		} as never);
	}

	test('rejects a baseline whose lane does not match the requested lane', async () => {
		// The API is documented to accept `lane` without necessarily filtering on
		// it yet (see the design doc). A response carrying the wrong lane must not
		// become a baseline: it would render as a cross-lane delta, exactly the
		// invalid comparison this whole change exists to prevent. This test fails
		// if the mismatch check is deleted, because the response's `desktop` lane
		// would otherwise map straight through baselineToSnapshot.
		await mockResponse(200, foundBody);
		expect(await fetchBaseline('idle', 'server')).toBeUndefined();
	});

	test('accepts a baseline whose lane matches the requested lane', async () => {
		await mockResponse(200, foundBody);
		const baseline = await fetchBaseline('idle', 'desktop');
		expect(baseline?.lane).toBe('desktop');
	});
});

describe('buildPayload lane', () => {
	test('carries the snapshot lane onto the payload', () => {
		const payload = buildPayload([{ ...snapshot, lane: 'server' as const }], meta);
		expect(payload.lane).toBe('server');
	});

	test('desktop snapshots publish lane desktop explicitly, never undefined', () => {
		// An absent lane would be defaulted server-side, which is a guess we can
		// avoid making by always stating it.
		const payload = buildPayload([{ ...snapshot, lane: 'desktop' as const }], meta);
		expect(payload.lane).toBe('desktop');
	});
});

describe('publishSnapshots quality precondition', () => {
	const baseSnapshot = { ...snapshot, stoppedGrowing: true, treeSettled: true };

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		delete process.env.MEMORY_PUBLISH;
	});

	test('refuses a snapshot whose tree never stopped growing', async () => {
		process.env.MEMORY_PUBLISH = 'true';
		const published = await publishSnapshots(
			[{ ...baseSnapshot, stoppedGrowing: false }], meta);
		expect(published).toBe(false);
		const { request } = await import('undici');
		expect(vi.mocked(request)).not.toHaveBeenCalled();
	});

	test('refuses a snapshot whose sampling never settled', async () => {
		process.env.MEMORY_PUBLISH = 'true';
		const published = await publishSnapshots(
			[{ ...baseSnapshot, treeSettled: false }], meta);
		expect(published).toBe(false);
		const { request } = await import('undici');
		expect(vi.mocked(request)).not.toHaveBeenCalled();
	});

	test('refuses when any one launch of three is unsettled', async () => {
		// The median of three is only as good as its worst launch, and a baseline
		// is permanent where a failed job is not.
		process.env.MEMORY_PUBLISH = 'true';
		const published = await publishSnapshots(
			[baseSnapshot, { ...baseSnapshot, treeSettled: false }, baseSnapshot], meta);
		expect(published).toBe(false);
		const { request } = await import('undici');
		expect(vi.mocked(request)).not.toHaveBeenCalled();
	});
});
