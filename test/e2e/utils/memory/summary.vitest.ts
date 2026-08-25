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
import { ActivatedExtension, LabeledProcess, MemorySnapshot } from './types.js';
import { MemoryScenario } from './scenarios.js';
import { MemoryLane } from './lanes.js';

const MB = 1024 * 1024;

const proc = (overrides: Partial<LabeledProcess> = {}): LabeledProcess => ({
	pid: 100, ppid: 1, depth: 0, processName: 'positron', processRole: 'main',
	labeled: true, cmdBasename: 'positron', pssBytes: 100 * MB, rssBytes: 200 * MB,
	pssMin: 100 * MB, pssMax: 100 * MB,
	pssSamples: [100 * MB, 100 * MB, 100 * MB], rssSamples: [200 * MB, 200 * MB, 200 * MB],
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

	test('trusts the snapshot JSON lane over the directory name it was found in', () => {
		const mislabeled = snapshot('idle', [proc()], 0, 'server');
		const root = writeArtifact('memory-report-desktop-idle', {
			'memory-snapshot-0.json': JSON.stringify(mislabeled)
		});

		const collected = collectScenarios(root);
		const idle = collected.find(c => c.scenario === 'idle' && c.snapshots.length > 0);

		expect(idle?.lane).toBe('server');
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
