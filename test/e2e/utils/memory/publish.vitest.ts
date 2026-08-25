/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, test } from 'vitest';
import { baselineToSnapshot, buildPayload, fetchBaseline, publishingEnabled, publishSnapshots, redactProcessName, RunMeta } from './publish.js';
import { LabeledProcess, MemorySnapshot } from './types.js';

const process1: LabeledProcess = {
	pid: 100, ppid: 1, depth: 0,
	processName: 'window [1] (secret-client-project)',
	processRole: 'renderer', labeled: true, cmdBasename: 'positron',
	pssBytes: 300, rssBytes: 600, pssMin: 290, pssMax: 310
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

describe('baselineToSnapshot', () => {
	test('returns undefined on a first run, when no baseline exists yet', () => {
		expect(baselineToSnapshot({ found: false }, 'idle')).toBeUndefined();
	});

	test('maps the fields the report delta reads', () => {
		const mapped = baselineToSnapshot({
			found: true,
			snapshot: {
				tree_total_pss_bytes: 1000,
				settle_ms: 5000,
				processes: [{ process_name: 'gpu-process', process_role: 'gpu', pss_bytes: 40 }],
				extensions: [{ extension_id: 'vscode.git' }]
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

describe('baseline activation events', () => {
	const baseline = (extensions: { extension_id: string; activation_event?: string | null }[]) =>
		baselineToSnapshot({
			found: true,
			snapshot: { tree_total_pss_bytes: 1000, settle_ms: 5000, processes: [], extensions }
		}, 'idle');

	test('carries the activation event through', () => {
		// Without it the report cannot tell an extension that was always eager
		// from one that just became eager, which is the whole point of the diff.
		const mapped = baseline([{ extension_id: 'github.copilot', activation_event: 'onStartupFinished' }]);
		expect(mapped?.extensions[0].activationEvent).toBe('onStartupFinished');
	});

	test('degrades to null when the endpoint does not send one', () => {
		const mapped = baseline([{ extension_id: 'github.copilot' }]);
		expect(mapped?.extensions[0].activationEvent).toBeNull();
	});
});

describe('publishingEnabled', () => {
	afterEach(() => { delete process.env.MEMORY_PUBLISH; });

	test('is off unless explicitly turned on', () => {
		// The /memory endpoint does not exist yet. Off by default means a run
		// cannot post into the void, and cannot appear to have published.
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
		expect(await fetchBaseline('idle')).toBeUndefined();
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
