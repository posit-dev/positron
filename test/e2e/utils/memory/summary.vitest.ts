/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { buildSummaryMatrix, renderSummaryHtml, ScenarioSnapshots } from './summary.js';
import { buildLaneSections, collectScenarios, containerHtmlFrom, renderLaneSectionsHtml } from './summarize-cli.js';
import { ActivatedExtension, ExtensionHeapBreakdown, LabeledProcess, MemorySnapshot } from './types.js';
import { MemoryScenario } from './scenarios.js';
import { MemoryLane } from './lanes.js';

const MB = 1024 * 1024;

/** The extension table's emphasis floor, mirrored from `summary.ts`. */
const MIN_EXTENSION_EMPHASIS_MB = 1;

const proc = (overrides: Partial<LabeledProcess> = {}): LabeledProcess => ({
	pid: 100, ppid: 1, depth: 0, processName: 'positron', processRole: 'main',
	labeled: true, cmdBasename: 'positron', pssBytes: 100 * MB, rssBytes: 200 * MB,
	pssMin: 100 * MB, pssMax: 100 * MB,
	pssSamples: [100 * MB, 100 * MB, 100 * MB], rssSamples: [200 * MB, 200 * MB, 200 * MB],
	forcedGc: false,
	...overrides
});

const extensions: ActivatedExtension[] = [];

const snapshot = (scenario: MemoryScenario, procs: LabeledProcess[], launchIndex = 0, lane: MemoryLane = 'desktop'): MemorySnapshot => ({
	scenario, lane, capturedAt: '2026-08-11T00:00:00.000Z',
	positronVersion: '2026.09.0-35', launchIndex, settleMs: 12_000,
	treeTotalPssBytes: procs.reduce((sum, p) => sum + p.pssBytes, 0),
	processes: procs, extensions
});

const scenarioEntry = (scenario: MemoryScenario, procs: LabeledProcess[]): ScenarioSnapshots => ({
	scenario,
	snapshots: [snapshot(scenario, procs, 0), snapshot(scenario, procs, 1), snapshot(scenario, procs, 2)]
});

/** One launch's heap partition, from `[extensionId, MB]` pairs plus the unattributed remainder. */
const heap = (extensions: [string, number][], unattributedMb: number): ExtensionHeapBreakdown => ({
	extensions: extensions.map(([extensionId, mb]) => ({ extensionId, retainedBytes: mb * MB })),
	unattributedBytes: unattributedMb * MB,
	reachableBytes: (unattributedMb + extensions.reduce((sum, [, mb]) => sum + mb, 0)) * MB
});

/** A scenario whose three launches all carry the same heap partition. */
const heapEntry = (scenario: MemoryScenario, breakdown: ExtensionHeapBreakdown): ScenarioSnapshots => ({
	scenario,
	snapshots: [0, 1, 2].map(i => ({
		...snapshot(scenario, [proc()], i),
		extensionHeap: breakdown,
		extensionHeapStatus: 'ok' as const
	}))
});

describe('extension matrix', () => {
	test('one row per extension, largest first, with unattributed last', () => {
		const matrix = buildSummaryMatrix([
			heapEntry('idle', heap([['a.big', 40], ['b.mid', 10]], 100)),
			heapEntry('notebook', heap([['a.big', 45], ['b.mid', 10]], 100))
		]);

		expect(matrix.extensions?.rows.map(r => r.extensionId)).toEqual(['a.big', 'b.mid', 'unattributed']);
		expect(matrix.extensionsUnavailable).toBeUndefined();
	});

	test('deltas are against idle, and an extension absent from idle counts from zero', () => {
		const matrix = buildSummaryMatrix([
			heapEntry('idle', heap([['a.big', 40]], 100)),
			heapEntry('notebook', heap([['a.big', 45], ['c.new', 20]], 100))
		]);

		const big = matrix.extensions!.rows.find(r => r.extensionId === 'a.big')!;
		expect(big.deltaVsIdle.notebook).toBe(5 * MB);
		expect(big.deltaVsIdle.idle).toBeUndefined();

		// Absent from idle means it retained nothing there, so the whole 20 MB is
		// what the scenario added. Reading it as "no baseline" hid that.
		const fresh = matrix.extensions!.rows.find(r => r.extensionId === 'c.new')!;
		expect(fresh.values.idle).toBeUndefined();
		expect(fresh.deltaVsIdle.notebook).toBe(20 * MB);
	});

	test('no extension is delta\'d from zero when idle attributed no heap at all', () => {
		const failedIdle = {
			scenario: 'idle' as const,
			snapshots: [{ ...snapshot('idle', [proc()], 0), extensionHeapStatus: 'parse_failed' as const }]
		};
		const matrix = buildSummaryMatrix([
			failedIdle,
			heapEntry('notebook', heap([['a.big', 45]], 100))
		]);

		// Otherwise every extension in every scenario reads as brand new, and a
		// broken idle run publishes a table of fabricated regressions.
		const big = matrix.extensions!.rows.find(r => r.extensionId === 'a.big')!;
		expect(big.deltaVsIdle.notebook).toBeUndefined();
	});

	test('every row, including the collapsed tail and unattributed, sums to TOTAL', () => {
		const tiny: [string, number][] = [['t.one', 0.1], ['t.two', 0.2]];
		const matrix = buildSummaryMatrix([
			heapEntry('idle', heap([['a.big', 40], ['b.mid', 10], ...tiny], 100)),
			heapEntry('notebook', heap([['a.big', 45], ['b.mid', 10], ...tiny], 100))
		]);

		// The point of the row: a reader adding the printed column reaches the
		// printed TOTAL. Summed from the rows for that reason, not from
		// reachableBytes, which need not equal them.
		const extensions = matrix.extensions!;
		for (const scenario of ['idle', 'notebook'] as const) {
			const sum = extensions.rows.reduce((total, row) => total + (row.values[scenario] ?? 0), 0);
			expect(extensions.totals[scenario]).toBeCloseTo(sum, 0);
		}
		expect(extensions.totals.idle).toBeCloseTo(150.3 * MB, 0);
		expect(extensions.totalDeltaVsIdle.notebook).toBeCloseTo(5 * MB, 0);
		expect(extensions.totalDeltaVsIdle.idle).toBeUndefined();
	});

	test('a scenario that attributed no heap gets no TOTAL rather than a zero', () => {
		const matrix = buildSummaryMatrix([
			heapEntry('idle', heap([['a.big', 40]], 100)),
			{ scenario: 'notebook' as const, snapshots: [{ ...snapshot('notebook', [proc()], 0), extensionHeapStatus: 'parse_failed' as const }] }
		]);

		// A zero would read as the whole extension host heap vanishing.
		expect(matrix.extensions!.totals.notebook).toBeUndefined();
		expect(matrix.extensions!.totalDeltaVsIdle.notebook).toBeUndefined();
	});

	test('an extension idle never loaded reads as new, not as a red regression', () => {
		const html = renderSummaryHtml(buildSummaryMatrix([
			heapEntry('idle', heap([['a.big', 40]], 100)),
			heapEntry('notebook', heap([['a.big', 40], ['c.new', 20]], 100))
		]));

		// The scenario activating an extension idle does not is what the scenario
		// is for, so it gets the neutral label, not the red "grew by 20 MB" that
		// means an already-loaded extension moved.
		const cell = html.split('c.new')[1].split('</tr>')[0];
		expect(cell).toContain('>new<');
		expect(cell).not.toContain('delta-up');
	});

	test('extensions under the floor in every scenario collapse into one row', () => {
		const tiny: [string, number][] = [['t.one', 0.1], ['t.two', 0.2]];
		const matrix = buildSummaryMatrix([
			heapEntry('idle', heap([['a.big', 40], ...tiny], 100)),
			heapEntry('notebook', heap([['a.big', 40], ...tiny], 100))
		]);

		expect(matrix.extensions?.collapsed).toBe(2);
		const others = matrix.extensions!.rows.find(r => r.extensionId.startsWith('('))!;
		expect(others.values.idle).toBeCloseTo(0.3 * MB, 0);
	});

	test('the collapsed tail can carry a delta like any other row', () => {
		const tiny = (mb: number): [string, number][] => [['t.one', mb], ['t.two', mb], ['t.three', mb]];
		const matrix = buildSummaryMatrix([
			heapEntry('idle', heap([['a.big', 40], ...tiny(0.2)], 100)),
			heapEntry('editors', heap([['a.big', 40], ...tiny(0.7)], 100))
		]);

		// Built with no threshold at all, this row could never render a delta, so a
		// tail that grew past the floor stayed blank while every other row moved.
		const others = matrix.extensions!.rows.find(r => r.extensionId.startsWith('('))!;
		expect(others.deltaVsIdle.editors).toBeCloseTo(1.5 * MB, 0);
		expect(others.emphasisThreshold.editors).toBe(MIN_EXTENSION_EMPHASIS_MB * MB);
	});

	test('an extension over the floor in one scenario stays its own row in all of them', () => {
		const matrix = buildSummaryMatrix([
			heapEntry('idle', heap([['a.spiky', 0.2]], 100)),
			heapEntry('notebook', heap([['a.spiky', 30]], 100))
		]);

		const row = matrix.extensions!.rows.find(r => r.extensionId === 'a.spiky')!;
		expect(row.values.idle).toBeCloseTo(0.2 * MB, 0);
		expect(matrix.extensions?.collapsed).toBe(0);
	});

	test('no attributed heap yields no table and a reason instead', () => {
		const entries: ScenarioSnapshots[] = [{
			scenario: 'idle',
			snapshots: [{ ...snapshot('idle', [proc()], 0), extensionHeapStatus: 'parse_failed' as const }]
		}];

		const matrix = buildSummaryMatrix(entries);

		expect(matrix.extensions).toBeUndefined();
		expect(matrix.extensionsUnavailable).toMatch(/could not be read back/);
	});

	test('the rendered card shows the extensions, or the reason when there are none', () => {
		const withHeap = renderSummaryHtml(buildSummaryMatrix([
			heapEntry('idle', heap([['a.big', 40]], 100)),
			heapEntry('notebook', heap([['a.big', 45]], 100))
		]));
		expect(withHeap).toContain('Extension host heap by extension');
		expect(withHeap).toContain('<code>a.big</code>');
		expect(withHeap).toContain('<em>unattributed</em>');

		const without = renderSummaryHtml(buildSummaryMatrix([scenarioEntry('idle', [proc()])]));
		expect(without).toContain('Extension host heap by extension');
		expect(without).not.toContain('<em>unattributed</em>');
	});
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

	test('orders columns idle first, then ascending by TOTAL delta vs idle', () => {
		const entries: ScenarioSnapshots[] = [
			scenarioEntry('idle', [proc({ pssBytes: 100 * MB })]),
			// Input order is the opposite of the expected sort, so the test only
			// passes if buildSummaryMatrix actually sorts rather than echoing input order.
			scenarioEntry('data-explorer', [proc({ pssBytes: 160 * MB })]), // +60 MB
			scenarioEntry('notebook', [proc({ pssBytes: 120 * MB })]), // +20 MB
		];

		const matrix = buildSummaryMatrix(entries);
		expect(matrix.scenarios).toEqual(['idle', 'notebook', 'data-explorer']);
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
	// The header used to restate what the columns already say. What a reader cannot
	// read off the table is which build produced the numbers.
	test('heads the report with the build, lane and launch count rather than a description of the table', () => {
		const entries: ScenarioSnapshots[] = [
			{ scenario: 'idle', snapshots: [snapshot('idle', [proc()], 0), snapshot('idle', [proc()], 1)] }
		];
		const html = renderSummaryHtml(buildSummaryMatrix(entries));

		expect(html).toContain('Build 2026.09.0-35');
		expect(html).toContain('Desktop');
		expect(html).toContain('2 launches/scenario');
		expect(html).toContain('Aug 11, 2026 at 00:00 UTC');
		expect(html).not.toContain('Median PSS per role');
	});

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

	test('footnotes the roles read after a forced GC, and only those', () => {
		const gc = (role: 'shared' | 'extension_host') => ({ role, pid: 1, preRssBytes: 1, postRssBytes: 1, preHeapTotalBytes: 1, postHeapTotalBytes: 1 });
		const procs = [proc({ processRole: 'shared' }), proc({ processRole: 'extension_host' }), proc({ processRole: 'main' })];

		const both = renderSummaryHtml(buildSummaryMatrix([
			{ scenario: 'idle', snapshots: [{ ...snapshot('idle', procs, 0), forcedGc: [gc('shared'), gc('extension_host')] }] }
		]));
		expect(both).toContain('<code>shared</code><span class="fn-marker">*</span>');
		expect(both).toContain('<code>extension_host</code><span class="fn-marker">*</span>');
		expect(both).toContain('<code>main</code></td>');
		// Under the table it qualifies, not in the copy above it.
		expect(both.indexOf('class="footnote"')).toBeGreaterThan(both.indexOf('</table>'));

		// The server lane collects only the extension host, so a fixed pair of roles
		// would footnote a `shared` figure that was never collected.
		const extHostOnly = renderSummaryHtml(buildSummaryMatrix([
			{ scenario: 'idle', snapshots: [{ ...snapshot('idle', procs, 0), forcedGc: [gc('extension_host')] }] }
		]));
		expect(extHostOnly).toContain('<code>extension_host</code><span class="fn-marker">*</span>');
		expect(extHostOnly).toContain('<code>shared</code></td>');
	});

	test('daggers a row absent from idle, and only that row', () => {
		const entries: ScenarioSnapshots[] = [
			scenarioEntry('idle', [proc({ processRole: 'main', pssBytes: 100 * MB })]),
			scenarioEntry('session-python', [
				proc({ processRole: 'main', pssBytes: 100 * MB }),
				proc({ pid: 2, processRole: 'kernel', pssBytes: 50 * MB }),
			]),
		];
		const html = renderSummaryHtml(buildSummaryMatrix(entries));
		expect(html).toContain('<span class="value">50.0 MB</span><span class="baseline-marker">&dagger;</span>');
		// main has an idle reading, so its value never carries the dagger.
		expect(html).toContain('<span class="value">100.0 MB</span></span>');
		expect(html).not.toContain('<span class="value">100.0 MB</span><span class="baseline-marker">');
		// Under the table it qualifies, not in the copy above it.
		expect(html.indexOf('Process not present in the idle baseline')).toBeGreaterThan(html.indexOf('</table>'));
	});

	test('omits the dagger and its footnote when every role has an idle reading', () => {
		const entries: ScenarioSnapshots[] = [
			scenarioEntry('idle', [proc({ processRole: 'main', pssBytes: 100 * MB })]),
			scenarioEntry('session-python', [proc({ processRole: 'main', pssBytes: 105 * MB })]),
		];
		const html = renderSummaryHtml(buildSummaryMatrix(entries));
		expect(html).not.toContain('<span class="baseline-marker">');
		expect(html).not.toContain('Process not present in the idle baseline');
	});

	test('shows the GC note when a snapshot carries a forced-GC reading, not otherwise', () => {
		const withoutGc = renderSummaryHtml(buildSummaryMatrix([scenarioEntry('idle', [proc()])]));
		expect(withoutGc).not.toContain('forced garbage collection');

		const emptyGcSnapshot = { ...snapshot('idle', [proc()], 0), forcedGc: [] };
		const withEmptyGc = renderSummaryHtml(buildSummaryMatrix([{ scenario: 'idle', snapshots: [emptyGcSnapshot] }]));
		expect(withEmptyGc).not.toContain('forced garbage collection');

		const gcSnapshot = { ...snapshot('idle', [proc()], 0), forcedGc: [{ role: 'shared' as const, pid: 1, preRssBytes: 1, postRssBytes: 1, preHeapTotalBytes: 1, postHeapTotalBytes: 1 }] };
		const withGc = renderSummaryHtml(buildSummaryMatrix([{ scenario: 'idle', snapshots: [gcSnapshot] }]));
		expect(withGc).toContain('forced garbage collection');
	});
});

describe('lane partitioning', () => {
	// Desktop idle is ~1495 MB and a server tree is ~820 MB because the
	// renderer is in the browser. Differencing them yields a ~-675 MB "drop"
	// that sorts to a prominent column, which is the whole failure this
	// partition exists to prevent.
	const desktopIdle = snapshot('idle', [proc({ processRole: 'main', pssBytes: 1495 * MB })], 0, 'desktop');
	const serverIdle = snapshot('idle', [proc({ processRole: 'main', pssBytes: 820 * MB })], 0, 'server');

	test('a server column is never differenced against desktop idle', () => {
		const sections = buildLaneSections([
			{ lane: 'desktop', scenario: 'idle', snapshots: [desktopIdle] },
			{ lane: 'server', scenario: 'idle', snapshots: [serverIdle] }
		]);
		expect(sections.map(s => s.lane)).toEqual(['desktop', 'server']);
		const server = sections.find(s => s.lane === 'server')!;
		expect(server.matrix.scenarios).toEqual(['idle']);
		for (const row of server.matrix.rows) {
			expect(row.deltaVsIdle).toEqual({});
		}
	});

	test('a lane with no data produces no section rather than an empty one', () => {
		const sections = buildLaneSections([
			{ lane: 'desktop', scenario: 'idle', snapshots: [desktopIdle] }
		]);
		expect(sections.map(s => s.lane)).toEqual(['desktop']);
	});
});

describe('collectScenarios lane provenance', () => {
	// A directory literally named memory-report-desktop-idle, whose snapshot JSON
	// says 'server': the only fixture shape that can distinguish "grouped by the
	// directory name" from "grouped by the snapshot's own field". A fixture where
	// the two agree would pass even if collectScenarios reverted to trusting the
	// directory, which is the exact regression this test exists to catch.
	const writeArtifact = (dirName: string, files: Record<string, string>): string => {
		const root = mkdtempSync(join(tmpdir(), 'memory-summarize-'));
		const dir = join(root, dirName);
		mkdirSync(dir, { recursive: true });
		for (const [name, contents] of Object.entries(files)) {
			writeFileSync(join(dir, name), contents);
		}
		return root;
	};

	test('surfaces an artifact from a lane that expects no scenarios, rather than dropping it silently', () => {
		// The server lane is parked, so EXPECTED_SCENARIOS_BY_LANE.server is empty and
		// no lane directory is expected. A lane with no expected scenarios must still
		// be walked: skipping it wholesale would silently discard an artifact that did
		// arrive, which is how someone re-enabling the matrix row without restoring
		// the expectation entry would get a report that omits their lane and calls
		// itself a success.
		const root = writeArtifact('memory-report-server-idle', {
			'memory-snapshot-0.json': JSON.stringify(snapshot('idle', [proc()], 0, 'server'))
		});

		const collected = collectScenarios(root);
		const serverIdle = collected.find(c => c.lane === 'server' && c.scenario === 'idle');

		expect(serverIdle, 'the server artifact vanished from the report entirely').toBeDefined();
		expect(serverIdle!.warnings.join(' ')).toContain('memory-report-server-idle');
	});

	test('trusts the snapshot JSON lane over the directory name it was found in', () => {
		const mislabeled = snapshot('idle', [proc()], 0, 'server');
		const root = writeArtifact('memory-report-desktop-idle', {
			'memory-snapshot-0.json': JSON.stringify(mislabeled)
		});

		const collected = collectScenarios(root);
		const idle = collected.find(c => c.scenario === 'idle' && c.snapshots.length > 0);

		expect(idle?.lane).toBe('server');
	});

	test('warns and drops a snapshot whose lane is not a recognized member, rather than silently dropping it later', () => {
		// A lane string outside MEMORY_LANES flowing through unchecked would pass
		// straight into buildLaneSections, which filters entries against
		// MEMORY_LANES and drops anything that does not match with no warning at
		// all. This test fails if the isMemoryLane guard in collectScenarios is
		// removed: the bogus lane would then flow through as `idle?.lane` instead
		// of being caught here with a warning.
		const bogus = { ...snapshot('idle', [proc()], 0, 'desktop'), lane: 'bogus-lane' };
		const root = writeArtifact('memory-report-desktop-idle', {
			'memory-snapshot-0.json': JSON.stringify(bogus)
		});

		const collected = collectScenarios(root);
		const idle = collected.find(c => c.scenario === 'idle');

		expect(idle?.snapshots).toHaveLength(0);
		expect(idle?.lane).toBe('desktop');
		expect(idle?.warnings.some(w => w.includes('not a recognized lane'))).toBe(true);
	});

	test('falls back to the directory name when no snapshot could be parsed', () => {
		const root = writeArtifact('memory-report-desktop-idle', {
			'memory-snapshot-0.json': 'not valid json'
		});

		const collected = collectScenarios(root);
		const idle = collected.find(c => c.scenario === 'idle');

		// Nothing parsed, so there is no snapshot lane to trust; the directory's
		// lane is the only thing left to attribute the warning to.
		expect(idle?.snapshots).toHaveLength(0);
		expect(idle?.lane).toBe('desktop');
		expect(idle?.warnings.some(w => w.includes('could not parse'))).toBe(true);
	});
});

describe('renderLaneSectionsHtml', () => {
	const desktopIdle = snapshot('idle', [proc({ processRole: 'main', pssBytes: 1495 * MB })], 0, 'desktop');
	const serverIdle = snapshot('idle', [proc({ processRole: 'main', pssBytes: 820 * MB })], 0, 'server');

	test('combines every lane into one document with exactly one outer <html>', () => {
		const sections = buildLaneSections([
			{ lane: 'desktop', scenario: 'idle', snapshots: [desktopIdle] },
			{ lane: 'server', scenario: 'idle', snapshots: [serverIdle] }
		]);
		const html = renderLaneSectionsHtml(sections);

		expect(html).toContain('<h1>desktop lane</h1>');
		expect(html).toContain('<h1>server lane</h1>');
		// One <html> for the whole document; a second would mean a per-lane
		// document got nested wholesale instead of just its container markup.
		expect(html.match(/<html/g)).toHaveLength(1);
		expect(html).toContain('<!DOCTYPE html>');
	});

	// The combined page builds its own <html> shell, so it has to opt into the
	// matrix rules explicitly: with only REPORT_CSS it lost the stacked delta
	// lines, the baseline tint and the container width, and rendered as a
	// different table from the per-lane document it is stitched from.
	test('carries the matrix styling and the container width the per-lane document has', () => {
		const sections = buildLaneSections([{ lane: 'desktop', scenario: 'idle', snapshots: [desktopIdle] }]);
		const html = renderLaneSectionsHtml(sections);

		expect(html).toContain('.matrix .delta-line');
		expect(html).toContain('.matrix .baseline');
		expect(html).toContain('<div class="container">');
	});

	// One lane is the normal case, and there the heading was a second title above
	// a header that already names the lane.
	test('drops the lane heading when there is only one lane', () => {
		const sections = buildLaneSections([{ lane: 'desktop', scenario: 'idle', snapshots: [desktopIdle] }]);
		expect(renderLaneSectionsHtml(sections)).not.toContain('<h1>desktop lane</h1>');
	});

	test('names the lane whose total is not comparable across lanes', () => {
		const sections = buildLaneSections([{ lane: 'server', scenario: 'idle', snapshots: [serverIdle] }]);
		expect(renderLaneSectionsHtml(sections)).toContain('not comparable to the desktop lane');
	});
});

describe('containerHtmlFrom', () => {
	test('extracts the container markup from a well-formed document', () => {
		const doc = '<html><body><div class="container"><p>hi</p></div></body></html>';
		expect(containerHtmlFrom(doc, 'desktop')).toBe('<p>hi</p>');
	});

	test('throws rather than falling back to the whole document when the container markup is missing', () => {
		// Guards against renderSummaryHtml's output shape changing (container
		// renamed, or content added after its closing div) silently nesting a
		// whole document inside the combined report instead of failing the job.
		const doc = '<html><body><p>no container here</p></body></html>';
		expect(() => containerHtmlFrom(doc, 'server')).toThrow(/server/);
	});
});
