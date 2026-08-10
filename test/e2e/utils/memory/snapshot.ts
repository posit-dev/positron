/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from 'path';
import { normalizeProcessName, resolveRole } from './label.js';
import { readProcessNames } from './positron-status.js';
import { readProcessTree } from './process-tree.js';
import { ActivatedExtension, LabeledProcess, MemorySnapshot, RawProcess } from './types.js';

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function depthOf(pid: number, byPid: Map<number, RawProcess>, rootPid: number): number {
	let depth = 0;
	let current = byPid.get(pid);
	while (current && current.pid !== rootPid && depth < 50) {
		current = byPid.get(current.ppid);
		depth++;
	}
	return depth;
}

/**
 * Join one sample's process list with Positron's names, resolve roles, and fold
 * in the per-pid median across all samples.
 */
export function joinProcesses(
	raw: RawProcess[],
	names: Map<number, string>,
	rootPid: number,
	samples: RawProcess[][]
): LabeledProcess[] {
	const byPid = new Map(raw.map(p => [p.pid, p]));

	const pssByPid = new Map<number, number[]>();
	for (const sample of samples) {
		for (const proc of sample) {
			const seen = pssByPid.get(proc.pid) ?? [];
			seen.push(proc.pssBytes);
			pssByPid.set(proc.pid, seen);
		}
	}

	return raw.map(proc => {
		// Normalized once, here, so the name the role rules see is the same one the
		// report and the payload carry.
		const reported = names.get(proc.pid);
		const positronName = reported === undefined ? undefined : normalizeProcessName(reported);
		const { role, labeled } = resolveRole({
			positronName,
			cmd: proc.cmd,
			isRoot: proc.pid === rootPid
		});
		const observed = pssByPid.get(proc.pid) ?? [proc.pssBytes];
		return {
			pid: proc.pid,
			ppid: proc.ppid,
			depth: depthOf(proc.pid, byPid, rootPid),
			processName: positronName ?? basename(proc.cmd.split(' ')[0] || 'unknown'),
			processRole: role,
			labeled,
			cmdBasename: basename(proc.cmd.split(' ')[0] || 'unknown'),
			pssBytes: median(observed),
			rssBytes: proc.rssBytes,
			pssMin: Math.min(...observed),
			pssMax: Math.max(...observed)
		};
	});
}

const totalPss = (procs: RawProcess[]): number => procs.reduce((sum, p) => sum + p.pssBytes, 0);

/** How many consecutive readings within `SETTLE_TOLERANCE` mean the tree has settled. */
const SETTLE_READINGS = 3;
const SETTLE_TOLERANCE = 0.01;

/**
 * Whether a sequence of PSS totals has settled: the last `SETTLE_READINGS`
 * consecutive readings each within 1% of the one before it.
 *
 * Pure so it can be tested against synthetic sequences. Note this returns false
 * for a single reading: one measurement says nothing about whether the tree is
 * still growing.
 *
 * A total of zero counts as settled. It means the root process is gone, and there
 * is nothing left to wait for; the caller's quality gate rejects the empty tree.
 */
export function isSettled(readings: number[]): boolean {
	if (readings.length === 0) {
		return false;
	}
	if (readings[readings.length - 1] === 0) {
		return true;
	}
	if (readings.length <= SETTLE_READINGS) {
		return false;
	}
	return readings
		.slice(-SETTLE_READINGS)
		.every((value, index, recent) => {
			const previous = index === 0 ? readings[readings.length - SETTLE_READINGS - 1] : recent[index - 1];
			return previous > 0 && Math.abs(value - previous) / previous < SETTLE_TOLERANCE;
		});
}

/**
 * Wait until the process tree stops growing, rather than sleeping a fixed
 * amount. Returns how long that took, which is worth recording on its own.
 */
export async function waitForSettle(
	rootPid: number,
	options: { pollMs?: number; capMs?: number } = {}
): Promise<number> {
	const pollMs = options.pollMs ?? 1000;
	const capMs = options.capMs ?? 90_000;
	const started = Date.now();
	const readings: number[] = [];

	while (Date.now() - started < capMs) {
		readings.push(totalPss(await readProcessTree(rootPid)));
		if (isSettled(readings)) {
			break;
		}
		await new Promise(resolve => setTimeout(resolve, pollMs));
	}
	return Date.now() - started;
}

/** Take three samples five seconds apart once the app has settled. */
export async function captureSnapshot(input: {
	rootPid: number;
	buildRoot: string;
	userDataDir: string;
	launchIndex: number;
	extensions: ActivatedExtension[];
}): Promise<MemorySnapshot> {
	const settleMs = await waitForSettle(input.rootPid);

	const samples: RawProcess[][] = [];
	for (let i = 0; i < 3; i++) {
		if (i > 0) {
			await new Promise(resolve => setTimeout(resolve, 5000));
		}
		samples.push(await readProcessTree(input.rootPid));
	}

	const names = await readProcessNames(input.buildRoot, input.userDataDir);
	const processes = joinProcesses(samples[samples.length - 1], names, input.rootPid, samples);

	return {
		scenario: 'idle',
		launchIndex: input.launchIndex,
		settleMs,
		treeTotalPssBytes: processes.reduce((sum, p) => sum + p.pssBytes, 0),
		processes,
		extensions: input.extensions
	};
}
