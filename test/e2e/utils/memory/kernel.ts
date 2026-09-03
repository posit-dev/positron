/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-language decomposition of the `kernel` role.
 *
 * A lot of a session scenario's memory is the kernel itself, and the role table
 * reports it as one flat figure while the process tree reports it as unaggregated
 * pids. This is the middle view the extension host already has: the role's total,
 * split by which language runtime holds it.
 *
 * Pure functions only, like the rest of the report modules: no I/O, so both the
 * per-scenario report and the scenario summary can build their own tables from
 * these without either owning the mapping.
 */

import { LabeledProcess, MemorySnapshot, ProcessRole } from './types.js';

/**
 * The only role in scope.
 *
 * `kernel_supervisor` (kcserver, the supervisor wrapper script) and
 * `language_server` (ruff, tsserver, Quarto's LSP) are adjacent roles and
 * deliberately excluded: restricting to `kernel` is what keeps these figures
 * summing to a row the role table already shows, rather than double-counting
 * against two of them.
 */
const KERNEL_ROLE: ProcessRole = 'kernel';

export const KERNEL_LABEL_ARK = 'R (ark)';
export const KERNEL_LABEL_PYTHON = 'Python';
export const KERNEL_LABEL_UNKNOWN = 'unknown';

/**
 * Maps a kernel process's command basename to a stable series label.
 *
 * The twin of `kernel_label_for()` in the dashboard's
 * `src/helpers/kernel_trend_helpers.R`, which derives the same labels from the
 * same `cmd_basename` field of the published payload. The two must agree: the
 * dashboard stores the label rather than deriving it at read time, so a
 * disagreement is repaired by a re-backfill, not a redeploy. The sum-invariant
 * test in `render.vitest.ts` is the alarm for our half drifting.
 *
 * Only the basename is available, so the Python kernel arrives as `python3`, or
 * `python3.11` depending on the runner image. Matching any `^python` under this
 * role means an image bump cannot silently fork one series into two.
 *
 * An unmapped basename appears as itself rather than being swallowed into an
 * "other" bucket, so a kernel we have never measured shows up the first night it
 * runs -- unnamed, but visible.
 */
export function kernelLabelFor(cmdBasename: string): string {
	if (cmdBasename === '') {
		return KERNEL_LABEL_UNKNOWN;
	}
	if (cmdBasename === 'ark') {
		return KERNEL_LABEL_ARK;
	}
	if (cmdBasename.startsWith('python')) {
		return KERNEL_LABEL_PYTHON;
	}
	return cmdBasename;
}

function kernelProcesses(snapshot: MemorySnapshot): LabeledProcess[] {
	return snapshot.processes.filter(proc => proc.processRole === KERNEL_ROLE);
}

/**
 * One launch's kernel PSS per label, in first-seen order. Empty for a scenario
 * that starts no session, which is what lets the callers omit the whole section
 * rather than render an empty table.
 */
export function kernelTotals(snapshot: MemorySnapshot): Map<string, number> {
	const totals = new Map<string, number>();
	for (const proc of kernelProcesses(snapshot)) {
		const label = kernelLabelFor(proc.cmdBasename);
		totals.set(label, (totals.get(label) ?? 0) + proc.pssBytes);
	}
	return totals;
}

/**
 * How many processes each label's figure adds up, at its highest across
 * launches.
 *
 * The max rather than a median: the count is shown to warn that a figure is a
 * sum, and a launch that spawned a second kernel is exactly what the reader
 * needs told, not a value it can be averaged out of.
 */
export function kernelProcessCounts(snapshots: MemorySnapshot[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const snapshot of snapshots) {
		const perLaunch = new Map<string, number>();
		for (const proc of kernelProcesses(snapshot)) {
			const label = kernelLabelFor(proc.cmdBasename);
			perLaunch.set(label, (perLaunch.get(label) ?? 0) + 1);
		}
		for (const [label, count] of perLaunch) {
			counts.set(label, Math.max(counts.get(label) ?? 0, count));
		}
	}
	return counts;
}
