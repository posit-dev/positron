/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The scenario memory report: one matrix comparing every scenario's per-role
 * median PSS side by side, plus a delta against `idle`.
 *
 * The tree TOTAL swings tens of MB launch to launch for reasons unrelated to
 * any code change (the renderer alone), which swamps the regressions this
 * effort exists to catch. Per-role numbers are far quieter, so the matrix
 * here -- not the total -- is meant to be the default view. Pure functions
 * only: no file I/O, no process access, so this is unit-testable without a
 * real memory run.
 */

import { deltaHtmlFromDiff, escapeHtml, formatBytes, GC_FOOTNOTE, notSteadyStateCardHtml, REPORT_CSS } from './report-shell.js';
import { kernelProcessCounts, kernelTotals } from './kernel.js';
import { byRole, EXTENSION_HEAP_FLOOR_BYTES, extensionHeapUnavailableText, UNATTRIBUTED_ROW } from './render.js';
import { unstableProcesses } from './snapshot.js';
import { MemoryLane } from './lanes.js';
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

/**
 * One extension's median retained heap across every scenario that attributed one.
 *
 * Deliberately the same shape as {@link SummaryRow}: the two tables share their
 * cell renderer, so a change to how a delta is emphasized cannot apply to one
 * table and not the other.
 */
export type ExtensionSummaryRow = {
	extensionId: string;
	values: Partial<Record<MemoryScenario, number>>;
	deltaVsIdle: Partial<Record<MemoryScenario, number>>;
	emphasisThreshold: Partial<Record<MemoryScenario, number>>;
};

export type ExtensionMatrix = {
	/** Largest first, with the sub-floor tail collapsed and `unattributed` last. */
	rows: ExtensionSummaryRow[];
	/** How many extensions the "(N others)" row folds up. Zero when none were. */
	collapsed: number;
	/** The whole attributed heap: the sum of every row above, per scenario. */
	totals: Partial<Record<MemoryScenario, number>>;
	totalDeltaVsIdle: Partial<Record<MemoryScenario, number>>;
	totalEmphasisThreshold: Partial<Record<MemoryScenario, number>>;
};

/**
 * One kernel language's median PSS across every scenario that ran it.
 *
 * No `deltaVsIdle`, unlike {@link SummaryRow} and {@link ExtensionSummaryRow}:
 * idle starts no session, so every kernel row's baseline cell is absent and a
 * delta column would be empty down its whole length. The comparison a reader
 * wants here is across the scenario columns, not against idle.
 */
export type KernelSummaryRow = {
	/** A label from `kernelLabelFor`: `R (ark)`, `Python`, or an unmapped basename. */
	label: string;
	values: Partial<Record<MemoryScenario, number>>;
	/**
	 * How many processes each scenario's figure sums, at its highest across that
	 * scenario's launches. Per cell rather than per row: one scenario running a
	 * second kernel was previously reported as a suffix on the label, which read
	 * as a claim about every cell in the row.
	 */
	processCounts: Partial<Record<MemoryScenario, number>>;
};

export type KernelMatrix = {
	/** Largest first, by the biggest cell in the row. No floor: there are only ever a handful of labels. */
	rows: KernelSummaryRow[];
	/** The whole `kernel` role per scenario: the sum of every row above. Absent for a scenario that ran none. */
	totals: Partial<Record<MemoryScenario, number>>;
	/** Kernel processes per scenario across every label, for the TOTAL row's marker. */
	totalProcessCounts: Partial<Record<MemoryScenario, number>>;
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

/**
 * What run produced the matrix, all read off the snapshots rather than passed
 * in, so the header cannot claim a build the figures did not come from.
 */
export type SummaryMeta = {
	/**
	 * Version plus build number, e.g. `2026.09.0-35`. A list because more than
	 * one means the matrix jobs did not all run the same build, and a delta
	 * across two builds is not a delta -- the header has to say so rather than
	 * quietly show the first one.
	 */
	builds: string[];
	lanes: MemoryLane[];
	/** Launches per scenario. Min and max differ when a scenario lost a launch. */
	launches: { min: number; max: number };
	/** Latest `capturedAt` across every snapshot, ISO 8601. */
	capturedAt?: string;
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
	/**
	 * The roles whose figures were read after a forced garbage collection, taken
	 * from the readings themselves rather than a fixed list: the server lane
	 * collects only the extension host, so hardcoding both would footnote a
	 * `shared` row that was never collected. Empty when no snapshot forced a GC,
	 * which is what gates the footnote.
	 */
	forcedGcRoles: ProcessRole[];
	/**
	 * Decomposition of the `extension_host` row, one extension per row and the
	 * same scenario columns. Undefined when no scenario attributed a heap, which
	 * the section reports as unavailable rather than as an empty table.
	 */
	extensions?: ExtensionMatrix;
	/** Why there is no `extensions` table, when there is none. */
	extensionsUnavailable?: string;
	/**
	 * Decomposition of the `kernel` row, one language per row and the same
	 * scenario columns. Undefined when no scenario ran a kernel, which the
	 * report omits rather than reporting as unavailable: unlike a failed heap
	 * attribution, a run with no kernel is a legitimate result.
	 */
	kernels?: KernelMatrix;
	/** What run this matrix describes, for the header. */
	meta: SummaryMeta;
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
 * Per role, because the noise is not uniform: `kernel` holds to 0.6 MB across
 * launches while `extension_host` swings 37.7 MB, so one flat rule either marks
 * noise on the shaky roles or misses real moves on the steady ones.
 *
 * Scoped to the two scenarios the delta is actually between, since a delta is only
 * as good as the shakier of its two. Reading the bar from every scenario instead
 * let one scenario's bad launch silence a real change everywhere else: one noisy
 * `data-explorer` launch once set an `extension_host` bar of 73.9 MB, hiding a
 * steady +67.9 MB on `notebook`.
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

/** Collects the header facts from the same snapshots the matrix is built from. */
function buildSummaryMeta(entries: ScenarioSnapshots[]): SummaryMeta {
	const snapshots = entries.flatMap(e => e.snapshots);
	const counts = entries.map(e => e.snapshots.length).filter(n => n > 0);
	return {
		builds: [...new Set(snapshots.map(s => s.positronVersion).filter(Boolean))],
		lanes: [...new Set(snapshots.map(s => s.lane))],
		launches: counts.length === 0 ? { min: 0, max: 0 } : { min: Math.min(...counts), max: Math.max(...counts) },
		capturedAt: snapshots.map(s => s.capturedAt).sort().at(-1)
	};
}

/**
 * Smallest extension delta that can ever be emphasized.
 *
 * An order of magnitude below {@link MIN_EMPHASIS_BYTES} because extensions sit
 * an order of magnitude below roles: applying the role floor here would clear no
 * extension in the table, since the largest is 19.5 MB and most are under 3 MB.
 *
 * Calibrated against four CI runs (2026-09-01, 108 launches). Between-run spread
 * per extension topped out at 197 KB and within-run spread at 1.07 MB, the latter
 * concentrated in `console-output` and `editors`. The per-scenario spread term
 * already covers that 1.07 MB case; this floor is what guards the far commoner
 * case of an extension that simply did not move across three launches.
 */
const MIN_EXTENSION_EMPHASIS_BYTES = EXTENSION_HEAP_FLOOR_BYTES;

/**
 * One launch's retained bytes per extension, plus the unattributed remainder.
 * Empty for a launch whose attribution failed, which is what keeps a failed
 * launch out of the medians rather than in them as a fabricated zero.
 */
function extensionTotals(snapshot: MemorySnapshot): Map<string, number> {
	const totals = new Map<string, number>();
	if (snapshot.extensionHeapStatus !== 'ok' || snapshot.extensionHeap === undefined) {
		return totals;
	}
	for (const extension of snapshot.extensionHeap.extensions) {
		totals.set(extension.extensionId, extension.retainedBytes);
	}
	totals.set(UNATTRIBUTED_ROW, snapshot.extensionHeap.unattributedBytes);
	return totals;
}

/** Median and spread per extension, over only the launches that attributed a heap. */
function extensionStats(snapshots: MemorySnapshot[]): { medians: Map<string, number>; spreads: Map<string, number> } {
	const perLaunch = snapshots.map(extensionTotals).filter(totals => totals.size > 0);
	const medians = new Map<string, number>();
	const spreads = new Map<string, number>();
	const extensions = new Set(perLaunch.flatMap(totals => [...totals.keys()]));
	for (const extension of extensions) {
		// Zero-filled across the attributed launches only: an extension that loaded
		// in one launch and not another really did retain nothing in the other.
		const values = perLaunch.map(totals => totals.get(extension) ?? 0);
		medians.set(extension, median(values));
		spreads.set(extension, Math.max(...values) - Math.min(...values));
	}
	return { medians, spreads };
}

/**
 * Builds the per-extension matrix, mirroring the role matrix column for column.
 *
 * The floor is applied to a row's largest cell across all scenarios, not per
 * cell: judging each cell on its own would blank an extension in the scenarios
 * where it sits just under the floor and show it in the one where it does not,
 * so a row would read as intermittent when it is merely small.
 */
function buildExtensionMatrix(entries: ScenarioSnapshots[], scenarios: MemoryScenario[]): ExtensionMatrix | undefined {
	const statsByScenario = new Map<MemoryScenario, ReturnType<typeof extensionStats>>();
	for (const { scenario, snapshots } of entries) {
		statsByScenario.set(scenario, extensionStats(snapshots));
	}
	const attributed = [...statsByScenario.values()].some(stats => stats.medians.size > 0);
	if (!attributed) {
		return undefined;
	}

	// Kept per launch, not just as medians: a summed row's run-to-run spread has to
	// be measured on the sums, and the parts peak in different launches.
	const launchTotals = new Map<MemoryScenario, Map<string, number>[]>();
	for (const { scenario, snapshots } of entries) {
		launchTotals.set(scenario, snapshots.map(extensionTotals).filter(totals => totals.size > 0));
	}
	/** Run-to-run spread of `extensionIds` summed together, which is not the sum of their spreads. */
	const spreadOfSum = (scenario: MemoryScenario, extensionIds: string[]): number => {
		const sums = (launchTotals.get(scenario) ?? [])
			.map(totals => extensionIds.reduce((sum, id) => sum + (totals.get(id) ?? 0), 0));
		return sums.length > 0 ? Math.max(...sums) - Math.min(...sums) : 0;
	};

	const idle = statsByScenario.get('idle');
	// An extension missing from idle retained nothing there rather than having no
	// baseline to measure from, so its delta is the whole value: that is the number
	// the scenario added. Only true when idle itself attributed a heap -- without
	// this guard a failed idle run reads as every extension appearing from zero.
	const idleAttributed = (idle?.medians.size ?? 0) > 0;
	const idleMedian = (extensionId: string) => idle?.medians.get(extensionId) ?? 0;
	const extensions = new Set([...statsByScenario.values()].flatMap(stats => [...stats.medians.keys()]));

	const buildRow = (extensionId: string): ExtensionSummaryRow => {
		const values: Partial<Record<MemoryScenario, number>> = {};
		const deltaVsIdle: Partial<Record<MemoryScenario, number>> = {};
		const threshold: Partial<Record<MemoryScenario, number>> = {};
		const idleSpread = idle?.spreads.get(extensionId) ?? 0;
		for (const scenario of scenarios) {
			const stats = statsByScenario.get(scenario)!;
			const value = stats.medians.get(extensionId);
			if (value !== undefined) {
				values[scenario] = value;
			}
			threshold[scenario] = Math.max(MIN_EXTENSION_EMPHASIS_BYTES, idleSpread, stats.spreads.get(extensionId) ?? 0);
			if (scenario !== 'idle' && value !== undefined && idleAttributed) {
				deltaVsIdle[scenario] = value - idleMedian(extensionId);
			}
		}
		return { extensionId, values, deltaVsIdle, emphasisThreshold: threshold };
	};

	const peak = (extensionId: string) => Math.max(0, ...[...statsByScenario.values()].map(s => s.medians.get(extensionId) ?? 0));
	const named = [...extensions].filter(e => e !== UNATTRIBUTED_ROW).sort((a, b) => peak(b) - peak(a));
	const shown = named.filter(e => peak(e) >= EXTENSION_HEAP_FLOOR_BYTES);
	const collapsed = named.filter(e => peak(e) > 0 && peak(e) < EXTENSION_HEAP_FLOOR_BYTES);

	const rows = shown.map(buildRow);
	if (collapsed.length > 0) {
		// Summed per scenario rather than per row, so the collapsed line still
		// compares like for like down its column.
		const values: Partial<Record<MemoryScenario, number>> = {};
		const deltaVsIdle: Partial<Record<MemoryScenario, number>> = {};
		const sumFor = (scenario: MemoryScenario) => collapsed.reduce((sum, e) => sum + (statsByScenario.get(scenario)!.medians.get(e) ?? 0), 0);
		// Left without a threshold this row could never render a delta at all, so a
		// tail that grew past the floor stayed silent while the legend promised
		// otherwise. It is a real aggregate and is judged like any other row.
		const threshold: Partial<Record<MemoryScenario, number>> = {};
		for (const scenario of scenarios) {
			values[scenario] = sumFor(scenario);
			threshold[scenario] = Math.max(
				MIN_EXTENSION_EMPHASIS_BYTES, spreadOfSum('idle', collapsed), spreadOfSum(scenario, collapsed));
			if (scenario !== 'idle' && idleAttributed) {
				deltaVsIdle[scenario] = sumFor(scenario) - sumFor('idle');
			}
		}
		rows.push({ extensionId: `(${collapsed.length} others)`, values, deltaVsIdle, emphasisThreshold: threshold });
	}
	if (extensions.has(UNATTRIBUTED_ROW)) {
		rows.push(buildRow(UNATTRIBUTED_ROW));
	}

	// Summed from the rendered rows rather than taken from `reachableBytes`, so
	// the column a reader adds up is the column that is printed. A median of the
	// per-launch totals would be the better statistic but need not equal the sum
	// of the per-extension medians, which is the whole point of showing it.
	const totals: Partial<Record<MemoryScenario, number>> = {};
	const totalDeltaVsIdle: Partial<Record<MemoryScenario, number>> = {};
	const totalEmphasisThreshold: Partial<Record<MemoryScenario, number>> = {};
	const everyExtension = [...extensions];
	const sumOfRows = (scenario: MemoryScenario) => rows.reduce((sum, row) => sum + (row.values[scenario] ?? 0), 0);
	for (const scenario of scenarios) {
		if (statsByScenario.get(scenario)!.medians.size === 0) {
			continue;
		}
		totals[scenario] = sumOfRows(scenario);
		totalEmphasisThreshold[scenario] = Math.max(
			MIN_EXTENSION_EMPHASIS_BYTES, spreadOfSum('idle', everyExtension), spreadOfSum(scenario, everyExtension));
		if (scenario !== 'idle' && idleAttributed) {
			totalDeltaVsIdle[scenario] = totals[scenario]! - sumOfRows('idle');
		}
	}

	return { rows, collapsed: collapsed.length, totals, totalDeltaVsIdle, totalEmphasisThreshold };
}

/**
 * Builds the per-kernel matrix, mirroring the role matrix column for column.
 *
 * No floor and no collapsed tail, unlike the extension matrix: a scenario runs
 * one or two kernels, so every row is worth a line. A label absent from a
 * launch counts as zero in that scenario's median, the same zero-filling
 * `byRole` does; a label absent from the scenario entirely stays absent, so the
 * cell renders an em-dash rather than a 0 MB kernel that never ran.
 */
function buildKernelMatrix(entries: ScenarioSnapshots[], scenarios: MemoryScenario[]): KernelMatrix | undefined {
	const mediansByScenario = new Map<MemoryScenario, Map<string, number>>();
	for (const { scenario, snapshots } of entries) {
		const perLaunch = snapshots.map(kernelTotals);
		const labels = new Set(perLaunch.flatMap(totals => [...totals.keys()]));
		mediansByScenario.set(scenario, new Map([...labels].map(label => [
			label, median(perLaunch.map(totals => totals.get(label) ?? 0))
		])));
	}
	const labels = new Set([...mediansByScenario.values()].flatMap(medians => [...medians.keys()]));
	if (labels.size === 0) {
		return undefined;
	}

	// Kept per scenario rather than maxed into one number per label: the count is
	// a property of the scenario that ran the kernel, and only one scenario has
	// ever run two.
	const countsByScenario = new Map<MemoryScenario, Map<string, number>>();
	for (const { scenario, snapshots } of entries) {
		countsByScenario.set(scenario, kernelProcessCounts(snapshots));
	}

	const peak = (label: string) => Math.max(0, ...[...mediansByScenario.values()].map(m => m.get(label) ?? 0));
	const rows: KernelSummaryRow[] = [...labels]
		.sort((a, b) => peak(b) - peak(a))
		.map(label => {
			const values: Partial<Record<MemoryScenario, number>> = {};
			for (const scenario of scenarios) {
				const value = mediansByScenario.get(scenario)?.get(label);
				if (value !== undefined) {
					values[scenario] = value;
				}
			}
			const processCounts: Partial<Record<MemoryScenario, number>> = {};
			for (const scenario of scenarios) {
				const count = countsByScenario.get(scenario)?.get(label);
				if (count !== undefined) {
					processCounts[scenario] = count;
				}
			}
			return { label, values, processCounts };
		});

	// Summed from the rendered rows, so the column a reader adds up is the column
	// that is printed. A scenario that ran no kernel is left absent rather than
	// totalled to zero.
	const totals: Partial<Record<MemoryScenario, number>> = {};
	const totalProcessCounts: Partial<Record<MemoryScenario, number>> = {};
	for (const scenario of scenarios) {
		if ((mediansByScenario.get(scenario)?.size ?? 0) === 0) {
			continue;
		}
		totals[scenario] = rows.reduce((sum, row) => sum + (row.values[scenario] ?? 0), 0);
		// Summed, not maxed: TOTAL spans the labels, so two kernels of one language
		// and one of another is three processes in that column.
		totalProcessCounts[scenario] = rows.reduce((sum, row) => sum + (row.processCounts[scenario] ?? 0), 0);
	}

	return { rows, totals, totalProcessCounts };
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

	const forcedGcRoles = [...new Set(entries.flatMap(({ snapshots }) => snapshots.flatMap(s => (s.forcedGc ?? []).map(gc => gc.role))))];

	const extensions = buildExtensionMatrix(entries, sortedScenarios);
	// Resolved here rather than at render time: the reason lives in the raw
	// snapshots, which the matrix does not carry.
	const extensionsUnavailable = extensions ? undefined : extensionHeapUnavailableText(entries.flatMap(e => e.snapshots));

	const kernels = buildKernelMatrix(entries, sortedScenarios);

	return { scenarios: sortedScenarios, rows, totals, totalEmphasisThreshold, unstable, forcedGcRoles, extensions, extensionsUnavailable, kernels, meta: buildSummaryMeta(entries) };
}

/** Muted em-dash: a role that did not exist in this scenario, never a fabricated zero. */
const ABSENT_MARKER = '<span class="muted">&mdash;</span>';

/**
 * Shown once, below the table, whenever a row carries the dagger marker.
 * Kept next to {@link GC_FOOTNOTE}'s summary counterpart so a reader sees why a
 * `kernel`-like row has no delta: not because nothing changed, but because idle
 * never had this process to compare against.
 */
const NO_IDLE_BASELINE_FOOTNOTE = 'Process not present in the idle baseline.';

/** Marks the column every delta is measured from, so the table reads baseline -> comparisons. */
function baselineClass(scenario: MemoryScenario): string {
	return scenario === 'idle' ? ' class="baseline"' : '';
}

/**
 * One-line reminder of what each scenario measures, shown as a hover tooltip on
 * the column header. Kept brief on purpose -- the full rationale for a scenario
 * lives as a comment beside its `defineMemoryScenario` call, not here.
 */
const SCENARIO_DESCRIPTIONS: Record<MemoryScenario, string> = {
	'idle': 'Freshly launched app, nothing opened (baseline).',
	'session-python': 'A Python interpreter session, idle after startup.',
	'session-r': 'An R interpreter session, idle after startup.',
	'data-explorer': 'A small CSV opened in the Data Explorer.',
	'notebook': 'A 30-cell notebook opened with stored outputs.',
	'editors': 'Ten files of mixed languages open in editors.',
	'console-output': 'A Python session with 10k lines of console output.',
	'quarto-render': 'A Quarto document rendered to HTML.',
	'quarto-inline': 'A Quarto cell run inline, with a live kernel.'
};

function scenarioHeaderHtml(scenarios: MemoryScenario[]): string {
	return scenarios.map(s => `<th align="right"${baselineClass(s)} title="${escapeHtml(SCENARIO_DESCRIPTIONS[s])}">${escapeHtml(s)}</th>`).join('');
}

/** What one cell needs beyond its own number, all of it row-level. */
type CellOptions = {
	delta?: number;
	threshold?: number;
	/**
	 * Adds a dagger after the value when the row has no idle reading at all
	 * (`kernel`, typically): without it, a role that simply cannot be delta'd
	 * against idle looks identical to one that held flat.
	 */
	flagNoBaseline?: boolean;
	/**
	 * Renders `new` in place of the delta for a row idle never had.
	 *
	 * The delta there is the whole value, which the cell already prints, and a
	 * red "grew by 2.1 MB" reads as a regression when it only means the scenario
	 * activated an extension idle does not -- which is what the scenario is for.
	 */
	newInScenario?: boolean;
	/**
	 * How many processes this one figure sums, superscripted when above one.
	 *
	 * Per cell because the fact is per cell: only `quarto-inline` runs a second
	 * ark, and stating it once on the row label claimed it of `session-r` too.
	 */
	processCount?: number;
};

/** One scenario's cell: the value, plus (for a non-idle scenario) its delta against idle underneath. */
function cellHtml(scenario: MemoryScenario, value: number | undefined, options: CellOptions = {}): string {
	const { delta, threshold, flagNoBaseline, newInScenario, processCount } = options;
	if (value === undefined) {
		return `<td align="right"${baselineClass(scenario)}>${ABSENT_MARKER}</td>`;
	}
	if (newInScenario && scenario !== 'idle') {
		return `<td align="right"${baselineClass(scenario)}><span class="value-wrap"><span class="value">${formatBytes(value)}</span></span><span class="delta-line"><span class="delta-flat">new</span></span></td>`;
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
	// flagNoBaseline is only true for rows whose idle cell is absent, so this branch
	// (value !== undefined) never runs for scenario === 'idle' on such a row.
	// Positioned absolutely off `.value-wrap` rather than appended inline: an inline
	// dagger widens this cell's content, which widens the whole column and shifts
	// every other row's value left to share it, breaking the alignment down the column.
	// Same absolute-positioning trick for the same reason. Only one of the two can
	// ever apply to a cell: the dagger is a delta marker, and the kernel table
	// that carries counts has no deltas at all.
	const marker = flagNoBaseline
		? '<span class="baseline-marker">&dagger;</span>'
		: processCount !== undefined && processCount > 1
			? `<span class="count-marker">${processCount}</span>`
			: '';
	return `<td align="right"${baselineClass(scenario)}><span class="value-wrap"><span class="value">${formatBytes(value)}</span>${marker}</span>${deltaLine}</td>`;
}

function rowHtml(row: SummaryRow, scenarios: MemoryScenario[], forcedGcRoles: ProcessRole[]): string {
	const flagNoBaseline = scenarios.includes('idle') && row.values['idle'] === undefined;
	const cells = scenarios.map(scenario => cellHtml(scenario, row.values[scenario], {
		delta: row.deltaVsIdle[scenario], threshold: row.emphasisThreshold[scenario], flagNoBaseline
	})).join('');
	// Outside the <code>, so the marker cannot be misread as part of the role name.
	const marker = forcedGcRoles.includes(row.role) ? '<span class="fn-marker">*</span>' : '';
	return `<tr>
		<td><code>${escapeHtml(row.role)}</code>${marker}</td>
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
		// TOTAL is the tree sum, not a single process, so the missing-idle-baseline
		// dagger (which flags one absent role) never applies to it.
		return cellHtml(scenario, value, { delta, threshold: matrix.totalEmphasisThreshold[scenario] });
	}).join('');
	return `<tr class="total-row">
		<td><strong>TOTAL</strong></td>
		${cells}
	</tr>`;
}

/**
 * One extension row, reusing the role table's cell renderer so the two tables
 * emphasize, mute and align deltas identically.
 *
 * `unattributed` is italicised rather than code-formatted: it is not an
 * extension id, and setting it in the same face as one implies it is.
 */
function extensionRowHtml(row: ExtensionSummaryRow, scenarios: MemoryScenario[]): string {
	// Absent from idle and present here: the scenario loaded it, which is a
	// different fact from an extension that was already loaded and grew.
	const newInScenario = scenarios.includes('idle') && row.values['idle'] === undefined;
	const cells = scenarios.map(scenario => cellHtml(scenario, row.values[scenario], {
		delta: row.deltaVsIdle[scenario], threshold: row.emphasisThreshold[scenario], newInScenario
	})).join('');
	const label = row.extensionId === UNATTRIBUTED_ROW
		? `<em>${UNATTRIBUTED_ROW}</em>`
		: row.extensionId.startsWith('(')
			? `<span class="muted">${escapeHtml(row.extensionId)}</span>`
			: `<code>${escapeHtml(row.extensionId)}</code>`;
	return `<tr>
		<td>${label}</td>
		${cells}
	</tr>`;
}

/**
 * The extension table's TOTAL: the whole reachable extension host heap.
 *
 * Without it `unattributed` sat last in the bold, ruled treatment the role
 * table gives its TOTAL, so it read as the sum of the rows above rather than as
 * one more slice of the partition.
 */
function extensionTotalRowHtml(extensions: ExtensionMatrix, scenarios: MemoryScenario[]): string {
	const cells = scenarios.map(scenario => cellHtml(scenario, extensions.totals[scenario], {
		delta: extensions.totalDeltaVsIdle[scenario], threshold: extensions.totalEmphasisThreshold[scenario]
	})).join('');
	return `<tr class="total-row">
		<td><strong>TOTAL</strong></td>
		${cells}
	</tr>`;
}

/**
 * The extension section, or the sentence saying why there is none.
 *
 * Placed below the role table because it decomposes one of its rows: a reader
 * needs the `extension_host` figure before a breakdown of it means anything.
 */
function extensionCardHtml(matrix: SummaryMatrix): string {
	if (matrix.extensions === undefined) {
		return `<div class="card">
		<h2>Extension host heap by extension</h2>
		<p class="muted">${escapeHtml(matrix.extensionsUnavailable ?? '')}</p>
	</div>`;
	}
	const rows = matrix.extensions.rows.map(row => extensionRowHtml(row, matrix.scenarios)).join('\n');
	return `<div class="card">
		<h2>Extension host heap by extension</h2>
		<div class="meta">${EXTENSION_COVERAGE_NOTE}</div>
		<table class="matrix">
			<tr><th>Extension</th>${scenarioHeaderHtml(matrix.scenarios)}</tr>
			${rows}
			${extensionTotalRowHtml(matrix.extensions, matrix.scenarios)}
		</table>
		${matrix.extensions.collapsed > 0 ? `<div class="footnote">${matrix.extensions.collapsed} extension${matrix.extensions.collapsed === 1 ? '' : 's'} under ${formatBytes(EXTENSION_HEAP_FLOOR_BYTES)} in every scenario are folded into the "others" row.</div>` : ''}
	</div>`;
}

/**
 * What the figures are, the delta bar, and what `unattributed` holds.
 *
 * Deliberately terse: the table already carries most of this, so the note only
 * has to make it readable. How the partition is built, and why it sits under the
 * `extension_host` PSS row, belong in the module docs rather than above a table.
 *
 * Interpolates its own floor rather than spelling it out. {@link DELTA_LEGEND}
 * quotes the role floor, which is five times larger, so a hardcoded number here
 * would misstate the bar the moment either constant moved.
 */
const EXTENSION_COVERAGE_NOTE = `Reachable V8 heap by extension. Deltas flag changes beyond
	normal launch variation and &ge;${formatBytes(MIN_EXTENSION_EMPHASIS_BYTES)};
	<em>unattributed</em> includes host runtime and unowned extension code.`;

/**
 * The kernel section, or nothing at all.
 *
 * Below the role table because it decomposes one of its rows, and below the
 * extension table so the two breakdowns sit together. Cells carry no delta: see
 * {@link KernelSummaryRow}.
 */
function kernelCardHtml(matrix: SummaryMatrix): string {
	const kernels = matrix.kernels;
	if (kernels === undefined) {
		return '';
	}
	const rows = kernels.rows.map(row => {
		const cells = matrix.scenarios.map(scenario => cellHtml(scenario, row.values[scenario], {
			processCount: row.processCounts[scenario]
		})).join('');
		return `<tr>
		<td>${escapeHtml(row.label)}</td>
		${cells}
	</tr>`;
	}).join('\n');
	const totalCells = matrix.scenarios.map(scenario => cellHtml(scenario, kernels.totals[scenario], {
		processCount: kernels.totalProcessCounts[scenario]
	})).join('');

	return `<div class="card">
		<h2>Kernel memory by language</h2>
		<div class="meta">${KERNEL_COVERAGE_NOTE}</div>
		<table class="matrix">
			<tr><th>Kernel</th>${scenarioHeaderHtml(matrix.scenarios)}</tr>
			${rows}
			<tr class="total-row">
				<td><strong>TOTAL</strong></td>
				${totalCells}
			</tr>
		</table>
		${hasMultiProcessKernel(kernels) ? `<div class="footnote">${KERNEL_COUNT_FOOTNOTE}</div>` : ''}
	</div>`;
}

/** Whether any cell will carry a count marker, which gates the footnote explaining it. */
function hasMultiProcessKernel(kernels: KernelMatrix): boolean {
	return kernels.rows.some(row => Object.values(row.processCounts).some(count => count > 1));
}

const KERNEL_COUNT_FOOTNOTE = `A superscript is how many kernel processes that figure sums;
	an unmarked figure is a single process.`;

/**
 * Says what the rows are and, as importantly, why there are no deltas: idle
 * runs no kernel, so there is no baseline column to measure one from.
 */
const KERNEL_COVERAGE_NOTE = `Kernel memory by language runtime. Excludes
	<code>kernel_supervisor</code> and <code>language_server</code>;
	no deltas because idle has no kernel baseline.`;

/** True when at least one row will render the dagger marker, which gates the footnote explaining it. */
function hasNoBaselineRows(matrix: SummaryMatrix): boolean {
	return matrix.scenarios.includes('idle') && matrix.rows.some(row => row.values['idle'] === undefined);
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
const DELTA_LEGEND = `Deltas mark changes that exceed normal launch-to-launch variation
	and are at least ${formatBytes(MIN_EMPHASIS_BYTES)}.`;

/**
 * The rules only the matrix needs, on top of {@link REPORT_CSS}.
 *
 * Exported rather than inlined in the document below because the combined
 * multi-lane page in `summarize-cli.ts` builds its own `<html>` shell out of
 * these lanes' container markup: with only `REPORT_CSS` it lost the stacked
 * delta lines and the baseline tint, and the matrix silently rendered as a
 * different table from the per-lane one.
 */
export const SUMMARY_CSS = `
		/* A smidge wider than the shared 960px shell: the matrix has more columns to
		fit than the per-scenario report, so it benefits most from the extra room. */
		.container { max-width: 1200px; }
		/* Secondary to the title rather than a second headline: smaller and dimmer, with
		enough air under the h1 that the two still read as one block. */
		.header { padding: 13px 20px; }
		.header h1 { margin-bottom: 6px; }
		.header .meta { font-size: 0.8125rem; opacity: 0.72; }
		/* Whitespace instead of a rule. With two lines of copy stacked under it, the
		hairline cut the card into bands and the explanation drifted away from the table
		it belongs to. */
		.card h2 { border-bottom: none; padding-bottom: 0; margin-bottom: 6px; }
		/* Both lines under the heading read the same way: how to read a delta, and how the
		figures were taken. Styling one of them down invented a third level of hierarchy
		the wording already carries, so they share a size, color and weight and are
		separated only by the gap between them. */
		.card .meta { font-size: 0.875rem; line-height: 1.35; margin-bottom: 0; }
		.card .meta + .meta { margin-top: 5px; }
		/* Air before the table, so the copy does not sit on top of the header row. Set on
		the table rather than on the last .meta: the footnote below the table is a div
		too, so a :last-of-type rule on .meta silently stopped matching once it existed. */
		.matrix { margin-top: 20px; }
		/* Attached to the table it qualifies, and quieter than the copy above it: this
		is a reading-the-figures caveat, not something to take in before the data. */
		.footnote { color: #6b7280; font-size: 0.78rem; line-height: 1.35; margin-top: 10px; }
		/* Enough to see, not enough to break the role column's left edge. */
		.fn-marker { color: #9ca3af; }
		/* Sized to the value text alone (position: relative does not add to that), so the
		absolutely positioned dagger inside it cannot widen this cell and shift every
		other row's value in the column to share the extra space. */
		.value-wrap { position: relative; }
		.baseline-marker, .count-marker { position: absolute; left: 100%; top: 0; margin-left: 1px; font-size: 0.7em; line-height: 1; color: #9ca3af; }
		/* Only some cells carry a delta on a second line. Centering would then drop a bare
		value half a line below its emphasized neighbour, so the row no longer reads
		across. Top-aligned, every PSS figure shares a baseline and the deltas hang below. */
		/* Scoped to td, not th: scenario-name headers may wrap, but a PSS value or its
		delta must not break across lines. */
		.matrix td { vertical-align: top; white-space: nowrap; }
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
		/* The header text alone doesn't look interactive, so a small marker plus the
		help cursor signals that hovering a scenario name reveals a description. */
		.matrix th[title] { cursor: help; }
		/* Role and idle (what every delta is measured from) stay in view while the rest
		of the matrix scrolls horizontally; .card supplies the overflow-x. Widths are
		fixed so the second sticky column's left offset lines up with the first. */
		.matrix th:first-child, .matrix td:first-child {
			position: sticky; left: 0; z-index: 2;
			box-sizing: border-box; width: 150px;
			background: white;
		}
		.matrix th.baseline, .matrix td.baseline {
			position: sticky; left: 150px; z-index: 1;
			box-sizing: border-box; width: 130px;
		}
		@media (prefers-color-scheme: dark) {
			.matrix .value { color: #9ca3af; }
			.matrix .baseline { background: #201f1e; border-right-color: #3a3a38; }
			.matrix tr:hover td:not(.baseline) { background: rgba(255, 255, 255, 0.04); }
			.footnote { color: #9ca3af; }
			.matrix th:first-child, .matrix td:first-child { background: #262624; }
		}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `Aug 26, 2026 at 14:38 UTC` from an ISO timestamp. The minute is as precise as
 * a nightly needs, and UTC is named rather than converted: the reader is usually
 * matching this against a CI run, which is stamped in UTC too.
 *
 * Built from the UTC getters rather than `toLocaleString`, whose output depends on
 * the machine's locale and would read differently for different readers.
 */
function formatCapturedAt(iso: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) {
		return iso;
	}
	const time = `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
	return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}, ${at.getUTCFullYear()} at ${time} UTC`;
}

/** `desktop` -> `Desktop`: the metadata line reads as labels, not as field values. */
function laneLabel(lane: MemoryLane): string {
	return lane.charAt(0).toUpperCase() + lane.slice(1);
}

/**
 * The header's second line: which build, lane and launches produced the figures.
 *
 * Replaced a restatement of what the table already shows ("median PSS per role,
 * delta against idle"), which a reader learns from the columns anyway. What they
 * cannot get from the table is which build this was, and that is the first thing
 * anyone asks of a number they want to file a regression against.
 */
function metaLineHtml(meta: SummaryMeta): string {
	const parts: string[] = [];
	if (meta.builds.length > 0) {
		parts.push(`Build ${meta.builds.map(escapeHtml).join(', ')}`);
	}
	if (meta.lanes.length > 0) {
		parts.push(meta.lanes.map(lane => escapeHtml(laneLabel(lane))).join(', '));
	}
	if (meta.launches.max > 0) {
		const count = meta.launches.min === meta.launches.max ? `${meta.launches.max}` : `${meta.launches.min}-${meta.launches.max}`;
		parts.push(`${count} launches/scenario`);
	}
	if (meta.capturedAt !== undefined) {
		parts.push(escapeHtml(formatCapturedAt(meta.capturedAt)));
	}
	return parts.join(' &middot; ');
}

/**
 * Renders the matrix as a standalone HTML document, using the same shell
 * (CSS, escaping, delta glyphs) as the per-scenario report so the two cannot
 * drift apart visually.
 */
export function renderSummaryHtml(matrix: SummaryMatrix): string {
	const rows = matrix.rows.map(row => rowHtml(row, matrix.scenarios, matrix.forcedGcRoles)).join('\n');
	const total = totalRowHtml(matrix);
	const instabilityCard = instabilityHtml(matrix.unstable);

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Scenario Memory Report</title>
	<style>${REPORT_CSS}${SUMMARY_CSS}
	</style>
</head>
<body>
<div class="container">
	<div class="header">
		<h1>Scenario Memory Report</h1>
		<div class="meta">${metaLineHtml(matrix.meta)}</div>
	</div>

	${instabilityCard}

	<div class="card">
		<h2>Memory by role</h2>
		<div class="meta">${DELTA_LEGEND}</div>
		<table class="matrix">
			<tr><th>Role</th>${scenarioHeaderHtml(matrix.scenarios)}</tr>
			${rows}
			${total}
		</table>
		${matrix.forcedGcRoles.length > 0 ? `<div class="footnote">* ${GC_FOOTNOTE}</div>` : ''}
		${hasNoBaselineRows(matrix) ? `<div class="footnote">&dagger; ${NO_IDLE_BASELINE_FOOTNOTE}</div>` : ''}
	</div>

	${extensionCardHtml(matrix)}

	${kernelCardHtml(matrix)}
</div>
</body>
</html>`;
}
