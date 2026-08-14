/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cross-scenario memory summary: one matrix comparing every scenario's
 * per-role median PSS side by side, plus a delta against `idle`.
 *
 * The tree TOTAL swings tens of MB launch to launch for reasons unrelated to
 * any code change (the renderer alone), which swamps the regressions this
 * effort exists to catch. Per-role numbers are far quieter, so the matrix
 * here -- not the total -- is meant to be the default view. Pure functions
 * only: no file I/O, no process access, so this is unit-testable without a
 * real memory run.
 */

import { deltaHtmlFromDiff, escapeHtml, formatBytes, GC_NOTE, notSteadyStateCardHtml, REPORT_CSS } from './report-shell.js';
import { byRole } from './render.js';
import { unstableProcesses } from './snapshot.js';
import { MemoryScenario } from './scenarios.js';
import { MemorySnapshot, ProcessRole } from './types.js';

export { byRole } from './render.js';

/** One scenario's launches, the input unit the matrix builder groups by. */
export type ScenarioSnapshots = {
	scenario: MemoryScenario;
	snapshots: MemorySnapshot[];
};

/**
 * One role's median PSS across every scenario that measured it.
 *
 * `values` and `deltaVsIdle` are partial records rather than
 * `Record<MemoryScenario, number>`: a role absent from a scenario (`kernel`
 * in idle, for example) must be distinguishable from a role that used zero
 * bytes, and an optional key is what makes "absent" representable at all.
 */
export type SummaryRow = {
	role: ProcessRole;
	values: Partial<Record<MemoryScenario, number>>;
	/** current - idle, present only when both the scenario and idle have this role. */
	deltaVsIdle: Partial<Record<MemoryScenario, number>>;
	/**
	 * Per scenario, how big that scenario's delta against idle has to be to earn
	 * emphasis. See {@link emphasisThreshold}.
	 */
	emphasisThreshold: Partial<Record<MemoryScenario, number>>;
};

/** One process that was still moving when it was sampled, named for the warning banner. */
export type UnstableEntry = {
	scenario: MemoryScenario;
	launchIndex: number;
	processName: string;
	role: ProcessRole;
	pssMin: number;
	pssMax: number;
	reported: number;
};

export type SummaryMatrix = {
	scenarios: MemoryScenario[];
	rows: SummaryRow[];
	/** Median tree total per scenario, for the TOTAL row. */
	totals: Partial<Record<MemoryScenario, number>>;
	/** The TOTAL row's own emphasis bar per scenario, from tree-total spread rather than any one role's. */
	totalEmphasisThreshold: Partial<Record<MemoryScenario, number>>;
	/**
	 * Carried on the matrix so `renderSummaryHtml` can warn without also taking
	 * the raw snapshots: every figure in the matrix is derived from processes that
	 * may have been moving, and this is what says which.
	 */
	unstable: UnstableEntry[];
	/** Whether any snapshot behind this matrix carries a forced-GC reading, so the legend can gate on it. */
	hasForcedGc: boolean;
};

/**
 * Smallest delta that can ever be emphasized, however steady a role looks.
 *
 * A role measured at exactly the same bytes in all three launches has an observed
 * spread of zero, and calibration alone would then emphasize a 0.1 MB delta as
 * though it were news. Three launches is too few to prove a process never moves.
 */
const MIN_EMPHASIS_BYTES = 5 * 1024 * 1024;

/**
 * Per role, because the noise is not uniform: `renderer` holds to 1.5 MB across
 * launches while `shared` swings 10.8 MB. A flat 5 MB rule drew a red arrow on
 * `extension_host` at +8.8 MB, inside that role's own scatter.
 *
 * Scoped to the two scenarios the delta is actually between, since a delta is only
 * as good as the shakier of its two. Reading the bar from every scenario instead
 * let one scenario's bad launch silence a real change everywhere else: a single
 * `data-explorer` launch 72 MB above its neighbours put the `extension_host` bar at
 * 73.9 MB, which hid `notebook` at +67.9 MB even though `notebook` itself only
 * swung 30 MB.
 */
function emphasisThreshold(spreads: number[]): number {
	return Math.max(MIN_EMPHASIS_BYTES, ...spreads);
}

/** One role's total in one launch, summing every process that shares the role. */
function roleTotals(snapshot: MemorySnapshot): Map<ProcessRole, number> {
	const totals = new Map<ProcessRole, number>();
	for (const proc of snapshot.processes) {
		totals.set(proc.processRole, (totals.get(proc.processRole) ?? 0) + proc.pssBytes);
	}
	return totals;
}

/**
 * How far a role's total moved across one scenario's launches. Zero-filled for a
 * missing launch, matching `byRole`, so an intermittent role reads as very noisy --
 * which is honest: it cannot support a claim about a few MB.
 */
function roleSpreads(snapshots: MemorySnapshot[]): Map<ProcessRole, number> {
	const perLaunch = snapshots.map(roleTotals);
	const roles = new Set(perLaunch.flatMap(totals => [...totals.keys()]));
	return new Map([...roles].map(role => {
		const values = perLaunch.map(totals => totals.get(role) ?? 0);
		return [role, Math.max(...values) - Math.min(...values)];
	}));
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Sum of the present values in a row, absent scenarios counting as zero, used only to order rows. */
function rowMagnitude(row: SummaryRow): number {
	return Object.values(row.values).reduce((sum: number, v) => sum + (v ?? 0), 0);
}

/**
 * Builds the per-role x per-scenario matrix.
 *
 * Columns are `idle` first (the baseline), then the rest ascending by TOTAL
 * delta vs idle, so the biggest total increase lands at the far right. Rows
 * are sorted biggest first (summed across the scenarios that have them) so
 * the roles worth reading about come before the ones that do not matter.
 * `deltaVsIdle` degrades to an empty object per row when `idle` is not among
 * `entries` -- there is nothing to diff against, not a NaN.
 */
export function buildSummaryMatrix(entries: ScenarioSnapshots[]): SummaryMatrix {
	const scenarios = entries.map(e => e.scenario);

	const rolesByScenario = new Map<MemoryScenario, Map<ProcessRole, number>>();
	const spreadsByScenario = new Map<MemoryScenario, Map<ProcessRole, number>>();
	for (const { scenario, snapshots } of entries) {
		rolesByScenario.set(scenario, byRole(snapshots));
		spreadsByScenario.set(scenario, roleSpreads(snapshots));
	}

	const idleRoles = rolesByScenario.get('idle');

	const allRoles = new Set<ProcessRole>();
	for (const roles of rolesByScenario.values()) {
		for (const role of roles.keys()) {
			allRoles.add(role);
		}
	}

	const rows: SummaryRow[] = [...allRoles].map(role => {
		const values: Partial<Record<MemoryScenario, number>> = {};
		const deltaVsIdle: Partial<Record<MemoryScenario, number>> = {};
		const threshold: Partial<Record<MemoryScenario, number>> = {};
		const idleSpread = spreadsByScenario.get('idle')?.get(role) ?? 0;

		for (const scenario of scenarios) {
			const value = rolesByScenario.get(scenario)!.get(role);
			if (value !== undefined) {
				values[scenario] = value;
			}
			threshold[scenario] = emphasisThreshold([idleSpread, spreadsByScenario.get(scenario)!.get(role) ?? 0]);
			if (idleRoles && scenario !== 'idle') {
				const idleValue = idleRoles.get(role);
				if (value !== undefined && idleValue !== undefined) {
					deltaVsIdle[scenario] = value - idleValue;
				}
			}
		}

		return { role, values, deltaVsIdle, emphasisThreshold: threshold };
	});

	rows.sort((a, b) => rowMagnitude(b) - rowMagnitude(a));

	const totals: Partial<Record<MemoryScenario, number>> = {};
	const totalSpreadByScenario = new Map<MemoryScenario, number>();
	for (const { scenario, snapshots } of entries) {
		const perLaunch = snapshots.map(s => s.treeTotalPssBytes);
		totals[scenario] = median(perLaunch);
		totalSpreadByScenario.set(scenario, Math.max(...perLaunch) - Math.min(...perLaunch));
	}

	// Same two-scenario scoping as the role rows above: the TOTAL bar for a scenario
	// is set by that scenario and idle, not by whichever scenario shook the most.
	const idleTotalSpread = totalSpreadByScenario.get('idle') ?? 0;
	const totalEmphasisThreshold: Partial<Record<MemoryScenario, number>> = {};
	for (const scenario of scenarios) {
		totalEmphasisThreshold[scenario] = emphasisThreshold([idleTotalSpread, totalSpreadByScenario.get(scenario) ?? 0]);
	}

	const unstable: UnstableEntry[] = entries.flatMap(({ scenario, snapshots }) =>
		snapshots.flatMap(snapshot => unstableProcesses(snapshot.processes).map(proc => ({
			scenario,
			launchIndex: snapshot.launchIndex,
			processName: proc.processName,
			role: proc.processRole,
			pssMin: proc.pssMin,
			pssMax: proc.pssMax,
			reported: proc.pssBytes
		}))));

	const idleTotal = totals['idle'];
	const totalDeltaVsIdle = new Map<MemoryScenario, number>();
	for (const scenario of scenarios) {
		const value = totals[scenario];
		totalDeltaVsIdle.set(scenario, idleTotal !== undefined && value !== undefined ? value - idleTotal : 0);
	}
	const others = scenarios.filter(s => s !== 'idle').sort((a, b) => totalDeltaVsIdle.get(a)! - totalDeltaVsIdle.get(b)!);
	const sortedScenarios = scenarios.includes('idle') ? ['idle' as MemoryScenario, ...others] : others;

	const hasForcedGc = entries.some(({ snapshots }) => snapshots.some(s => (s.forcedGc?.length ?? 0) > 0));

	return { scenarios: sortedScenarios, rows, totals, totalEmphasisThreshold, unstable, hasForcedGc };
}

/** Muted em-dash: a role that did not exist in this scenario, never a fabricated zero. */
const ABSENT_MARKER = '<span class="muted">&mdash;</span>';

/** Marks the column every delta is measured from, so the table reads baseline -> comparisons. */
function baselineClass(scenario: MemoryScenario): string {
	return scenario === 'idle' ? ' class="baseline"' : '';
}

function scenarioHeaderHtml(scenarios: MemoryScenario[]): string {
	return scenarios.map(s => `<th align="right"${baselineClass(s)}>${escapeHtml(s)}</th>`).join('');
}

/** One scenario's cell: the PSS value, plus (for a non-idle scenario) its delta against idle underneath. */
function cellHtml(scenario: MemoryScenario, value: number | undefined, delta: number | undefined, threshold: number | undefined): string {
	if (value === undefined) {
		return `<td align="right"${baselineClass(scenario)}>${ABSENT_MARKER}</td>`;
	}
	// Below the threshold nothing renders: a column of muted `-0.0 MB` spends a line
	// per row saying nothing happened, crowding the figures that did move.
	// An absent threshold cannot mean "emphasize everything": a scenario with no bar
	// computed for it has nothing to say a delta cleared anything.
	const emphasized = scenario === 'idle' || delta === undefined || threshold === undefined || Math.abs(delta) < threshold
		? ''
		: deltaHtmlFromDiff(delta);
	// The delta is the point of the table, so the value it is measured from steps back
	// a little rather than competing with it at equal weight.
	const deltaLine = emphasized === '' ? '' : `<span class="delta-line">${emphasized}</span>`;
	return `<td align="right"${baselineClass(scenario)}><span class="value">${formatBytes(value)}</span>${deltaLine}</td>`;
}

function rowHtml(row: SummaryRow, scenarios: MemoryScenario[]): string {
	const cells = scenarios.map(scenario => cellHtml(scenario, row.values[scenario], row.deltaVsIdle[scenario], row.emphasisThreshold[scenario])).join('');
	return `<tr>
		<td><code>${escapeHtml(row.role)}</code></td>
		${cells}
	</tr>`;
}

function totalRowHtml(matrix: SummaryMatrix): string {
	const cells = matrix.scenarios.map(scenario => {
		const value = matrix.totals[scenario];
		const idleValue = matrix.totals['idle'];
		const delta = scenario !== 'idle' && value !== undefined && idleValue !== undefined
			? value - idleValue
			: undefined;
		return cellHtml(scenario, value, delta, matrix.totalEmphasisThreshold[scenario]);
	}).join('');
	return `<tr class="total-row">
		<td><strong>TOTAL</strong></td>
		${cells}
	</tr>`;
}

/**
 * Warns that some of the matrix below is derived from processes that were still
 * moving. Empty when everything settled, so a healthy summary is unchanged.
 */
function instabilityHtml(unstable: UnstableEntry[]): string {
	if (unstable.length === 0) {
		return '';
	}
	const rows = unstable.map(entry => `<tr>
		<td>${escapeHtml(entry.scenario)}</td>
		<td class="num-cell" align="right">${entry.launchIndex}</td>
		<td>${escapeHtml(entry.processName)}</td>
		<td><code>${escapeHtml(entry.role)}</code></td>
		<td class="num-cell" align="right">${formatBytes(entry.pssMin)} &ndash; ${formatBytes(entry.pssMax)}</td>
		<td class="num-cell" align="right">${formatBytes(entry.reported)}</td>
	</tr>`).join('\n');

	return notSteadyStateCardHtml(['Scenario', '#Launch', 'Process', 'Role', '#Range', '#Reported'], rows);
}

/**
 * Says why some cells carry a delta and others do not, which is otherwise the
 * table's most obvious unexplained rule.
 *
 * Built from {@link MIN_EMPHASIS_BYTES} rather than repeating the number, so the
 * floor named here cannot drift from the one applied. Deliberately a minimum rather
 * than a flat "5 MB or more": the real bar is per role and usually higher, and a
 * legend that understated it would invite reading an unmarked 8 MB move as a bug.
 */
const DELTA_LEGEND = `Deltas appear only when a change beats launch-to-launch noise
	(${formatBytes(MIN_EMPHASIS_BYTES)} minimum); cells without one are within noise.`;

/**
 * Renders the matrix as a standalone HTML document, using the same shell
 * (CSS, escaping, delta glyphs) as the per-scenario report so the two cannot
 * drift apart visually.
 */
export function renderSummaryHtml(matrix: SummaryMatrix): string {
	const rows = matrix.rows.map(row => rowHtml(row, matrix.scenarios)).join('\n');
	const total = totalRowHtml(matrix);
	const instabilityCard = instabilityHtml(matrix.unstable);

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Positron memory: cross-scenario summary</title>
	<style>${REPORT_CSS}
		/* Reads as a summary rather than one more row: a darker rule than the hairlines
		between roles, and air above it that the hairlines do not get. */
		.total-row td { border-top: 2px solid #d1d5db; font-weight: 600; padding-top: 10px; }
		/* Only some cells carry a delta on a second line. Centering would then drop a bare
		value half a line below its emphasized neighbour, so the row no longer reads
		across. Top-aligned, every PSS figure shares a baseline and the deltas hang below. */
		.matrix td { vertical-align: top; }
		/* The delta is what the table is for, so the figure it is measured from gives up a
		little size and contrast instead of competing with it. */
		.matrix .value { font-size: 0.95em; color: #6b7280; }
		.matrix .total-row .value { font-size: 1em; color: inherit; }
		.matrix .delta-line { display: block; font-size: 0.82em; line-height: 1.2; margin-top: 1px; }
		/* idle is where every delta is measured from, not a seventh scenario. */
		.matrix .baseline { background: #f6f7f9; border-right: 2px solid #e5e7eb; }
		/* Follows one role across every scenario. Scoped to td so the header row, which
		holds th, does not light up as though it were data, and past .baseline so the idle
		cell keeps its own tint: the two values are close enough that the hovered row still
		reads as one band. */
		.matrix tr:hover td:not(.baseline) { background: #f8f9fa; }
		@media (prefers-color-scheme: dark) {
			.total-row td { border-top-color: #4b5563; }
			.matrix .value { color: #9ca3af; }
			.matrix .baseline { background: #201f1e; border-right-color: #3a3a38; }
			.matrix tr:hover td:not(.baseline) { background: rgba(255, 255, 255, 0.04); }
		}
	</style>
</head>
<body>
<div class="container">
	<div class="header">
		<h1>Cross-scenario memory summary</h1>
		<div class="meta">Median PSS per role across launches. Delta is against idle.</div>
	</div>

	${instabilityCard}

	<div class="card">
		<h2>By role</h2>
		<div class="meta">${DELTA_LEGEND}${matrix.hasForcedGc ? ` ${GC_NOTE}` : ''}</div>
		<table class="matrix">
			<tr><th>Role</th>${scenarioHeaderHtml(matrix.scenarios)}</tr>
			${rows}
			${total}
		</table>
	</div>
</div>
</body>
</html>`;
}
