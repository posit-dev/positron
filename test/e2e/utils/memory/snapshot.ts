/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from 'path';
import { getPositronVersion } from '../../infra/test-runner/positron-version.js';
import { deriveExtensionName, isGenericName, normalizeProcessName, resolveRole } from './label.js';
import { readProcessNames } from './positron-status.js';
import { readProcessTree } from './process-tree.js';
import { MemoryScenario } from './scenarios.js';
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
	const rssByPid = new Map<number, number[]>();
	for (const sample of samples) {
		for (const proc of sample) {
			const seenPss = pssByPid.get(proc.pid) ?? [];
			seenPss.push(proc.pssBytes);
			pssByPid.set(proc.pid, seenPss);

			const seenRss = rssByPid.get(proc.pid) ?? [];
			seenRss.push(proc.rssBytes);
			rssByPid.set(proc.pid, seenRss);
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
		// Preferred whenever Positron did not actually identify the process. That
		// covers two cases: no name at all or a raw command line (Positron could
		// not name it), and a generic wrapper name like `electron-nodejs (lsp.js)`,
		// which names the runtime and the script but not the owner. A real name
		// such as `extension-host [1]` still wins.
		const derived = reported === undefined || reported.startsWith('/') || isGenericName(reported)
			? deriveExtensionName(proc.cmd)
			: undefined;

		const observed = pssByPid.get(proc.pid) ?? [proc.pssBytes];
		// Aggregated the same way as pss on purpose. Taking rss from one sample
		// while pss was a median let a moving process report pss above its own
		// rss, which is impossible at any single instant.
		const observedRss = rssByPid.get(proc.pid) ?? [proc.rssBytes];
		return {
			pid: proc.pid,
			ppid: proc.ppid,
			depth: depthOf(proc.pid, byPid, rootPid),
			processName: derived ?? positronName ?? basename(proc.cmd.split(' ')[0] || 'unknown'),
			processRole: role,
			labeled,
			cmdBasename: basename(proc.cmd.split(' ')[0] || 'unknown'),
			pssBytes: median(observed),
			rssBytes: median(observedRss),
			pssMin: Math.min(...observed),
			pssMax: Math.max(...observed),
			pssSamples: observed,
			rssSamples: observedRss
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

/** How long settle detection waits before giving up and measuring anyway. */
export const SETTLE_CAP_MS = 90_000;

/**
 * Wait until the process tree stops growing, rather than sleeping a fixed
 * amount. Returns how long that took, which is worth recording on its own.
 */
export async function waitForSettle(
	rootPid: number,
	options: { pollMs?: number; capMs?: number } = {}
): Promise<number> {
	const pollMs = options.pollMs ?? 1000;
	const capMs = options.capMs ?? SETTLE_CAP_MS;
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

/**
 * How far a process's samples may span, relative to its own median, before that
 * median stops describing a steady state.
 *
 * Per process rather than per tree: `isSettled` compares whole-tree totals, so a
 * single process moving 130 MB is only 7% of a 1.9 GB tree and can hide inside a
 * total that looks flat.
 */
const UNSTABLE_SPREAD_FRACTION = 0.05;

/**
 * How many bytes a process's samples must span before the movement matters,
 * whatever the process's own size.
 *
 * Without this, the relative test alone flags the gpu process on every launch of
 * every scenario: it wobbles ~5 MB on an ~86 MB median, which is 6%. A 5 MB
 * wobble cannot move a 1.9 GB total, and a warning that fires on every run is
 * one nobody reads. Set below the 86 MB regression this effort exists to catch,
 * so movement large enough to be mistaken for one is always reported.
 *
 * The cost is that a small process moving a lot in relative terms stays quiet.
 * That is the intended trade: its effect on the total is under the noise the
 * report already lives with.
 */
const UNSTABLE_SPREAD_BYTES = 50 * 1024 * 1024;

/**
 * Whether a series of readings is close enough together that its median
 * describes a real state: movement has to be both large for the process and
 * large in absolute terms to count.
 *
 * One definition, used twice on purpose. It is what the sampling loop waits for
 * and what the report warns about, so a run can never both stop sampling and
 * then complain that it should not have. Fewer than two readings is steady by
 * default: one reading says nothing about movement.
 */
function isSteady(samples: number[]): boolean {
	if (samples.length < 2) {
		return true;
	}
	const mid = median(samples);
	if (mid <= 0) {
		return true;
	}
	const spread = Math.max(...samples) - Math.min(...samples);
	return !(spread / mid > UNSTABLE_SPREAD_FRACTION && spread > UNSTABLE_SPREAD_BYTES);
}

/**
 * How many trailing samples must agree for a process to count as holding steady.
 *
 * Four at 5s apart means the tail spans 15s. Three would be satisfied by the two
 * samples either side of the startup reclaim step plus one more; four cannot
 * straddle it.
 */
const TAIL_LENGTH = 4;

/**
 * Below this, a process is not consulted about whether the tree has settled.
 *
 * Small processes wobble by a few MB constantly (the zygote, the shell) and
 * would hold sampling open to the cap forever without being able to shift a
 * total measured in gigabytes.
 */
const SETTLE_MIN_PROCESS_BYTES = 50 * 1024 * 1024;

/**
 * Whether a process's last {@link TAIL_LENGTH} readings are flat.
 *
 * Only the tail is read, on purpose: every process steps down once during
 * startup as Chromium reclaims memory, and a rule that looked at the whole curve
 * would call that process unsettled forever. What matters is whether it is
 * steady *now*.
 */
export function tailIsFlat(samples: number[]): boolean {
	return samples.length >= TAIL_LENGTH && isSteady(samples.slice(-TAIL_LENGTH));
}

/**
 * How far the tree total must fall below its own peak before a flat tail is
 * believed.
 *
 * Flatness alone is not enough, and this is the trap worth spelling out: the
 * startup plateau is *also* flat. `idle` sits at a steady 559 MB renderer for
 * 20s, and a rule that only looked for flatness stopped there and reported that
 * plateau as the steady state -- a worse number than the mid-step median it
 * replaced. Waiting for the drop distinguishes "not moving yet" from "done
 * moving".
 *
 * 5% against a measured 12-20% drop in every launch, where sample-to-sample
 * jitter is about 1%.
 */
const RECLAIM_DROP_FRACTION = 0.05;

/**
 * Whether the tree has reclaimed its startup memory and then stopped moving.
 *
 * Two conditions, because either alone is wrong. The drop is checked on the tree
 * total, where the reclaim is unmissable (245 MB at the smallest). Flatness is
 * checked per process, because summing hides the movement worth waiting for: the
 * renderer's step is 45% of the renderer but 13% of the tree, and it overlaps
 * other processes still growing, so a total can cross it looking calm.
 *
 * An empty tree counts as settled: the root is gone, there is nothing to wait
 * for, and the caller's quality gate rejects it.
 */
export function treeHasSettled(samples: RawProcess[][]): boolean {
	if (samples.length < TAIL_LENGTH) {
		return false;
	}
	const totals = samples.map(totalPss);
	const peak = Math.max(...totals);
	const latest = totals[totals.length - 1];
	if (latest > peak * (1 - RECLAIM_DROP_FRACTION)) {
		return false;
	}

	const seriesByPid = new Map<number, number[]>();
	for (const sample of samples) {
		for (const proc of sample) {
			const series = seriesByPid.get(proc.pid) ?? [];
			series.push(proc.pssBytes);
			seriesByPid.set(proc.pid, series);
		}
	}
	return [...seriesByPid.values()]
		.filter(series => series[series.length - 1] >= SETTLE_MIN_PROCESS_BYTES)
		.every(tailIsFlat);
}

/**
 * Processes whose samples moved too much for their median to mean anything.
 *
 * Reported rather than thrown on: a caller decides whether an unstable process
 * invalidates the run. With the sampling loop waiting on {@link isSteady}, this
 * should now be empty unless a launch hit {@link SAMPLING_CAP_MS}.
 */
export function unstableProcesses(processes: LabeledProcess[]): LabeledProcess[] {
	return processes.filter(proc => proc.pssBytes > 0 && !isSteady(proc.pssSamples));
}

/**
 * Which build produced these numbers, as `2026.09.0-35`. Returns '' rather than
 * throwing; the spec asserts on it alongside the rest of the quality gate.
 */
function readPositronVersion(buildRoot: string): string {
	const version = getPositronVersion(buildRoot);
	return version ? `${version.positronVersion}-${version.buildNumber}` : '';
}

/**
 * How the sampling window is shaped, named so the report can describe itself.
 *
 * Sampling runs until {@link treeHasSettled} rather than for a fixed count.
 * A fixed window cannot work: every process releases its startup memory once, at
 * an age that depends on how long the scenario's own setup took, so any window
 * long enough to be past the step for `idle` is wasted on the session scenarios
 * and any window short enough to be cheap lands mid-step for one of them.
 */
const SAMPLE_INTERVAL_MS = 5000;

/** How long sampling waits for a flat tail before reporting a moving process anyway. */
export const SAMPLING_CAP_MS = 90_000;

/**
 * Sample the tree until every large process holds steady, then report only the
 * readings taken after it did.
 *
 * The startup plateau is discarded rather than averaged in. Including it made the
 * report claim a renderer used 422 MB when it had already settled at 285 MB, and
 * made `idle` look 113 MB heavier than a session -- an inversion that was purely
 * an artifact of `idle` reaching the sampler younger.
 */
export async function captureSnapshot(input: {
	scenario: MemoryScenario;
	rootPid: number;
	buildRoot: string;
	userDataDir: string;
	launchIndex: number;
	extensions: ActivatedExtension[];
}): Promise<MemorySnapshot> {
	const settleMs = await waitForSettle(input.rootPid);

	const samples: RawProcess[][] = [];
	const startedSampling = Date.now();
	while (Date.now() - startedSampling < SAMPLING_CAP_MS) {
		if (samples.length > 0) {
			await new Promise(resolve => setTimeout(resolve, SAMPLE_INTERVAL_MS));
		}
		samples.push(await readProcessTree(input.rootPid));
		if (treeHasSettled(samples)) {
			break;
		}
	}
	const sampledMs = Date.now() - startedSampling;

	// Only the flat tail is reported. The head is the startup plateau, and a
	// median taken across the step between them describes neither state.
	const reported = samples.slice(-TAIL_LENGTH);
	const names = await readProcessNames(input.buildRoot, input.userDataDir);
	const processes = joinProcesses(samples[samples.length - 1], names, input.rootPid, reported);

	return {
		scenario: input.scenario,
		capturedAt: new Date().toISOString(),
		positronVersion: readPositronVersion(input.buildRoot),
		launchIndex: input.launchIndex,
		settleMs,
		sampledMs,
		discardedSamples: samples.length - reported.length,
		treeTotalPssBytes: processes.reduce((sum, p) => sum + p.pssBytes, 0),
		processes,
		extensions: input.extensions
	};
}
