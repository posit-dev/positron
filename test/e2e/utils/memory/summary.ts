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

import { deltaHtmlFromDiff, escapeHtml, formatBytes, REPORT_CSS } from './report-shell.js';
import { byRole } from './render.js';
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
};

export type SummaryMatrix = {
	scenarios: MemoryScenario[];
	rows: SummaryRow[];
	/** Median tree total per scenario, for the TOTAL row. */
	totals: Partial<Record<MemoryScenario, number>>;
};

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
 * Order of `entries` becomes the column order. Rows are sorted biggest first
 * (summed across the scenarios that have them) so the roles worth reading
 * about come before the ones that do not matter. `deltaVsIdle` degrades to
 * an empty object per row when `idle` is not among `entries` -- there is
 * nothing to diff against, not a NaN.
 */
export function buildSummaryMatrix(entries: ScenarioSnapshots[]): SummaryMatrix {
	const scenarios = entries.map(e => e.scenario);

	const rolesByScenario = new Map<MemoryScenario, Map<ProcessRole, number>>();
	for (const { scenario, snapshots } of entries) {
		rolesByScenario.set(scenario, byRole(snapshots));
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

		for (const scenario of scenarios) {
			const value = rolesByScenario.get(scenario)!.get(role);
			if (value !== undefined) {
				values[scenario] = value;
			}
			if (idleRoles && scenario !== 'idle') {
				const idleValue = idleRoles.get(role);
				if (value !== undefined && idleValue !== undefined) {
					deltaVsIdle[scenario] = value - idleValue;
				}
			}
		}

		return { role, values, deltaVsIdle };
	});

	rows.sort((a, b) => rowMagnitude(b) - rowMagnitude(a));

	const totals: Partial<Record<MemoryScenario, number>> = {};
	for (const { scenario, snapshots } of entries) {
		totals[scenario] = median(snapshots.map(s => s.treeTotalPssBytes));
	}

	return { scenarios, rows, totals };
}

/** Muted em-dash: a role that did not exist in this scenario, never a fabricated zero. */
const ABSENT_MARKER = '<span class="muted">&mdash;</span>';

function scenarioHeaderHtml(scenarios: MemoryScenario[]): string {
	return scenarios.map(s => `<th align="right">${escapeHtml(s)}</th>`).join('');
}

/** One scenario's cell: the PSS value, plus (for a non-idle scenario) its delta against idle underneath. */
function cellHtml(scenario: MemoryScenario, value: number | undefined, delta: number | undefined): string {
	if (value === undefined) {
		return `<td align="right">${ABSENT_MARKER}</td>`;
	}
	const deltaLine = scenario === 'idle' || delta === undefined
		? ''
		: `<br><span style="font-size:0.85em">${deltaHtmlFromDiff(delta)}</span>`;
	return `<td align="right">${formatBytes(value)}${deltaLine}</td>`;
}

function rowHtml(row: SummaryRow, scenarios: MemoryScenario[]): string {
	const cells = scenarios.map(scenario => cellHtml(scenario, row.values[scenario], row.deltaVsIdle[scenario])).join('');
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
		return cellHtml(scenario, value, delta);
	}).join('');
	return `<tr class="total-row">
		<td><strong>TOTAL</strong></td>
		${cells}
	</tr>`;
}

/**
 * Renders the matrix as a standalone HTML document, using the same shell
 * (CSS, escaping, delta glyphs) as the per-scenario report so the two cannot
 * drift apart visually.
 */
export function renderSummaryHtml(matrix: SummaryMatrix): string {
	const rows = matrix.rows.map(row => rowHtml(row, matrix.scenarios)).join('\n');
	const total = totalRowHtml(matrix);

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Positron memory: cross-scenario summary</title>
	<style>${REPORT_CSS}
		.total-row td { border-top: 2px solid #e5e7eb; font-weight: 600; }
	</style>
</head>
<body>
<div class="container">
	<div class="header">
		<h1>Cross-scenario memory summary</h1>
		<div class="meta">Median PSS per role across launches. Delta is against idle.</div>
	</div>

	<div class="card">
		<h2>By role</h2>
		<table>
			<tr><th>Role</th>${scenarioHeaderHtml(matrix.scenarios)}</tr>
			${rows}
			${total}
		</table>
	</div>
</div>
</body>
</html>`;
}
