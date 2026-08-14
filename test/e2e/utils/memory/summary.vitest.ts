/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { buildSummaryMatrix, renderSummaryHtml, ScenarioSnapshots } from './summary.js';
import { ActivatedExtension, LabeledProcess, MemorySnapshot } from './types.js';
import { MemoryScenario } from './scenarios.js';

const MB = 1024 * 1024;

const proc = (overrides: Partial<LabeledProcess> = {}): LabeledProcess => ({
	pid: 100, ppid: 1, depth: 0, processName: 'positron', processRole: 'main',
	labeled: true, cmdBasename: 'positron', pssBytes: 100 * MB, rssBytes: 200 * MB,
	pssMin: 100 * MB, pssMax: 100 * MB,
	pssSamples: [100 * MB, 100 * MB, 100 * MB], rssSamples: [200 * MB, 200 * MB, 200 * MB],
	...overrides
});

const extensions: ActivatedExtension[] = [];

const snapshot = (scenario: MemoryScenario, procs: LabeledProcess[], launchIndex = 0): MemorySnapshot => ({
	scenario, capturedAt: '2026-08-11T00:00:00.000Z',
	positronVersion: '2026.09.0-35', launchIndex, settleMs: 12_000,
	treeTotalPssBytes: procs.reduce((sum, p) => sum + p.pssBytes, 0),
	processes: procs, extensions
});

const scenarioEntry = (scenario: MemoryScenario, procs: LabeledProcess[]): ScenarioSnapshots => ({
	scenario,
	snapshots: [snapshot(scenario, procs, 0), snapshot(scenario, procs, 1), snapshot(scenario, procs, 2)]
});

describe('buildSummaryMatrix', () => {
	test('produces one column per scenario and one row per role seen anywhere', () => {
		const entries: ScenarioSnapshots[] = [
			scenarioEntry('idle', [proc({ processRole: 'main', pssBytes: 100 * MB })]),
			scenarioEntry('session-python', [
				proc({ processRole: 'main', pssBytes: 100 * MB }),
				proc({ pid: 2, processRole: 'kernel', pssBytes: 50 * MB }),
			]),
			scenarioEntry('session-r', [
				proc({ processRole: 'main', pssBytes: 100 * MB }),
				proc({ pid: 2, processRole: 'kernel', pssBytes: 60 * MB }),
			]),
		];

		const matrix = buildSummaryMatrix(entries);

		expect(matrix.scenarios).toEqual(['idle', 'session-python', 'session-r']);
		const roles = matrix.rows.map(r => r.role);
		expect(roles).toContain('main');
		expect(roles).toContain('kernel');
		expect(matrix.rows).toHaveLength(2);
	});

	test('a role missing from a scenario is absent, not zero', () => {
		const entries: ScenarioSnapshots[] = [
			scenarioEntry('idle', [proc({ processRole: 'main', pssBytes: 100 * MB })]),
			scenarioEntry('session-python', [
				proc({ processRole: 'main', pssBytes: 100 * MB }),
				proc({ pid: 2, processRole: 'kernel', pssBytes: 50 * MB }),
			]),
		];

		const matrix = buildSummaryMatrix(entries);
		const kernelRow = matrix.rows.find(r => r.role === 'kernel')!;

		expect(kernelRow.values['idle']).toBeUndefined();
		expect(Object.keys(kernelRow.values)).not.toContain('idle');
		expect(kernelRow.values['session-python']).toBe(50 * MB);
	});

	test('computes delta vs idle for scenarios that share the role', () => {
		const entries: ScenarioSnapshots[] = [
			scenarioEntry('idle', [proc({ processRole: 'extension_child', pssBytes: 30 * MB })]),
			scenarioEntry('session-python', [proc({ processRole: 'extension_child', pssBytes: 45 * MB })]),
		];

		const matrix = buildSummaryMatrix(entries);
		const row = matrix.rows.find(r => r.role === 'extension_child')!;

		expect(row.deltaVsIdle['session-python']).toBe(15 * MB);
		// idle vs itself is not reported.
		expect(row.deltaVsIdle['idle']).toBeUndefined();
	});

	test('does not compute a delta for a role idle never had', () => {
		const entries: ScenarioSnapshots[] = [
			scenarioEntry('idle', [proc({ processRole: 'main', pssBytes: 100 * MB })]),
			scenarioEntry('session-python', [
				proc({ processRole: 'main', pssBytes: 100 * MB }),
				proc({ pid: 2, processRole: 'kernel', pssBytes: 50 * MB }),
			]),
		];

		const matrix = buildSummaryMatrix(entries);
		const kernelRow = matrix.rows.find(r => r.role === 'kernel')!;

		expect(kernelRow.deltaVsIdle['session-python']).toBeUndefined();
	});

	test('degrades gracefully, not to NaN, when idle is missing from the input entirely', () => {
		const entries: ScenarioSnapshots[] = [
			scenarioEntry('session-python', [proc({ processRole: 'main', pssBytes: 100 * MB })]),
			scenarioEntry('session-r', [proc({ processRole: 'main', pssBytes: 110 * MB })]),
		];

		const matrix = buildSummaryMatrix(entries);

		for (const row of matrix.rows) {
			expect(row.deltaVsIdle).toEqual({});
			for (const value of Object.values(row.deltaVsIdle)) {
				expect(Number.isNaN(value)).toBe(false);
			}
		}
	});

	test('orders rows biggest consumer first', () => {
		const entries: ScenarioSnapshots[] = [
			scenarioEntry('idle', [
				proc({ processRole: 'main', pssBytes: 100 * MB }),
				proc({ pid: 2, processRole: 'gpu', pssBytes: 10 * MB }),
				proc({ pid: 3, processRole: 'shared', pssBytes: 200 * MB }),
			]),
		];

		const matrix = buildSummaryMatrix(entries);
		expect(matrix.rows.map(r => r.role)).toEqual(['shared', 'main', 'gpu']);
	});

	test('records a median TOTAL per scenario', () => {
		const entries: ScenarioSnapshots[] = [
			{
				scenario: 'idle',
				snapshots: [
					snapshot('idle', [proc({ pssBytes: 100 * MB })], 0),
					snapshot('idle', [proc({ pssBytes: 120 * MB })], 1),
				]
			}
		];
		const matrix = buildSummaryMatrix(entries);
		expect(matrix.totals['idle']).toBe(110 * MB);
	});
});

describe('delta emphasis', () => {
	/** One scenario whose role total differs per launch, so the role has a measurable noise floor. */
	const noisyEntry = (scenario: MemoryScenario, role: LabeledProcess['processRole'], perLaunchMb: number[]): ScenarioSnapshots => ({
		scenario,
		snapshots: perLaunchMb.map((mb, index) => snapshot(scenario, [proc({ processRole: role, pssBytes: mb * MB })], index))
	});

	test('emphasizes a delta that clears the role noise floor', () => {
		const html = renderSummaryHtml(buildSummaryMatrix([
			noisyEntry('idle', 'renderer', [284, 285, 284]),
			noisyEntry('session-python', 'renderer', [306, 307, 306])
		]));
		expect(html).toContain('<span class="delta-up">&#9650; 22.0 MB</span>');
	});

	// The real case: session-r's extension_host read +8.8 MB against idle while the
	// same role swung 9.2 MB launch to launch within a single scenario. A flat 5 MB
	// rule drew a red arrow on that; the role's own spread is what says it is noise.
	test('says nothing about a delta inside the role own noise', () => {
		const html = renderSummaryHtml(buildSummaryMatrix([
			noisyEntry('idle', 'extension_host', [331, 340, 335]),
			noisyEntry('session-python', 'extension_host', [340, 344, 342])
		]));
		// Anchored on the attribute, not the bare class name: REPORT_CSS always
		// defines .delta-up, so a document-wide search for it can never fail.
		expect(html).not.toContain('class="delta-up"');
		expect(html).not.toContain('class="delta-down"');
	});

	test('still requires 5 MB from a role that never moves at all', () => {
		// Spread of zero would otherwise emphasize a 0.1 MB delta as though it mattered.
		const html = renderSummaryHtml(buildSummaryMatrix([
			noisyEntry('idle', 'shell', [100, 100, 100]),
			noisyEntry('session-python', 'shell', [102, 102, 102])
		]));
		expect(html).not.toContain('class="delta-up"');
		expect(html).not.toContain('+2.0 MB');
	});

	test('takes the noise floor from the noisiest scenario, not the one being read', () => {
		// idle is rock steady and session-python swings 12 MB. A floor read from idle
		// alone would emphasize a 6 MB delta that session-python cannot resolve.
		const html = renderSummaryHtml(buildSummaryMatrix([
			noisyEntry('idle', 'shared', [126, 126, 126]),
			noisyEntry('session-python', 'shared', [126, 138, 132])
		]));
		expect(html).not.toContain('class="delta-up"');
	});

	// A third scenario's bad launch used to set the bar for every scenario: one
	// data-explorer launch 72 MB above its neighbours put the extension_host bar at
	// 73.9 MB and hid notebook at +67.9 MB, which is the size of change this report
	// exists to catch.
	test('does not let an unrelated scenario noise floor hide a steady scenario delta', () => {
		const matrix = buildSummaryMatrix([
			noisyEntry('idle', 'extension_host', [332, 332, 335]),
			noisyEntry('notebook', 'extension_host', [400, 400, 400]),
			noisyEntry('data-explorer', 'extension_host', [336, 408, 334])
		]);

		// The bar notebook is judged against comes from notebook and idle only, so the
		// jumpy data-explorer launches cannot raise it.
		const row = matrix.rows.find(r => r.role === 'extension_host')!;
		expect(row.emphasisThreshold['notebook']).toBe(5 * MB);
		expect(row.emphasisThreshold['data-explorer']).toBe(74 * MB);

		const html = renderSummaryHtml(matrix);
		expect(html).toContain('<span class="delta-up">&#9650; 68.0 MB</span>');
	});
});

describe('renderSummaryHtml', () => {
	// This page is what the workflow links first, so a scenario measured mid-swing
	// has to say so here. Reading it only in the per-scenario report means the
	// landing page presents a contaminated delta as fact.
	test('names the scenario whose process was still moving', () => {
		const moving = proc({
			processName: 'window [1]', processRole: 'renderer',
			pssBytes: 433 * MB, pssMin: 306 * MB, pssMax: 439 * MB,
			pssSamples: [439 * MB, 433 * MB, 306 * MB], rssSamples: [514 * MB, 508 * MB, 381 * MB]
		});
		const entries: ScenarioSnapshots[] = [
			scenarioEntry('idle', [proc({ processRole: 'renderer', pssBytes: 546 * MB })]),
			scenarioEntry('session-python', [moving]),
		];
		const html = renderSummaryHtml(buildSummaryMatrix(entries));
		expect(html).toContain('Not a steady state');
		expect(html).toContain('session-python');
		expect(html).toContain('window [1]');
	});

	test('says nothing about stability when every scenario settled', () => {
		const entries: ScenarioSnapshots[] = [scenarioEntry('idle', [proc()])];
		expect(renderSummaryHtml(buildSummaryMatrix(entries))).not.toContain('Not a steady state');
	});

	test('renders an absent role as a clear marker, not zero', () => {
		const entries: ScenarioSnapshots[] = [
			scenarioEntry('idle', [proc({ processRole: 'main', pssBytes: 100 * MB })]),
			scenarioEntry('session-python', [
				proc({ processRole: 'main', pssBytes: 100 * MB }),
				proc({ pid: 2, processRole: 'kernel', pssBytes: 50 * MB }),
			]),
		];
		const html = renderSummaryHtml(buildSummaryMatrix(entries));
		const kernelRowHtml = html.split('<code>kernel</code>')[1].split('</tr>')[0];
		expect(kernelRowHtml).not.toMatch(/>\s*0\.0 MB\s*</);
		expect(kernelRowHtml).toContain('&mdash;');
	});

	test('renders a delta with a glyph, not color alone', () => {
		const entries: ScenarioSnapshots[] = [
			scenarioEntry('idle', [proc({ processRole: 'extension_child', pssBytes: 30 * MB })]),
			scenarioEntry('session-python', [proc({ processRole: 'extension_child', pssBytes: 45 * MB })]),
		];
		const html = renderSummaryHtml(buildSummaryMatrix(entries));
		expect(html).toMatch(/&#9650;[^<]*15\.0 MB/);
	});

	test('is a self-contained document', () => {
		const entries: ScenarioSnapshots[] = [scenarioEntry('idle', [proc()])];
		const html = renderSummaryHtml(buildSummaryMatrix(entries));
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('</html>');
	});

	test('escapes scenario and role names', () => {
		const entries: ScenarioSnapshots[] = [
			{
				scenario: 'idle',
				snapshots: [snapshot('idle', [proc({ processName: '<script>alert(1)</script>' })])]
			}
		];
		const html = renderSummaryHtml(buildSummaryMatrix(entries));
		expect(html).not.toContain('<script>alert(1)</script>');
	});

	test('includes a TOTAL row', () => {
		const entries: ScenarioSnapshots[] = [scenarioEntry('idle', [proc({ pssBytes: 100 * MB })])];
		const html = renderSummaryHtml(buildSummaryMatrix(entries));
		expect(html).toContain('TOTAL');
	});
});
