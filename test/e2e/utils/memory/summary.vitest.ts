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
	pssMin: 100 * MB, pssMax: 100 * MB, ...overrides
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
		expect('idle' in kernelRow.values).toBe(false);
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

describe('renderSummaryHtml', () => {
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

	test('renders a delta with a glyph and a signed number, not color alone', () => {
		const entries: ScenarioSnapshots[] = [
			scenarioEntry('idle', [proc({ processRole: 'extension_child', pssBytes: 30 * MB })]),
			scenarioEntry('session-python', [proc({ processRole: 'extension_child', pssBytes: 45 * MB })]),
		];
		const html = renderSummaryHtml(buildSummaryMatrix(entries));
		expect(html).toMatch(/&#9650;[^<]*\+15\.0 MB/);
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
