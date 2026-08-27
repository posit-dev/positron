/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from 'path';
import { readArkVersion } from '../ark-version.js';
import { getPositronVersion } from '../../infra/test-runner/positron-version.js';
import { ForcedGcStats } from './gc.js';
import { deriveExtensionName, isGenericName, normalizeProcessName, resolveRole } from './label.js';
import { MemoryLane } from './lanes.js';
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
			rssSamples: observedRss,
			// Corrected by withForcedGc, which runs where the GC pass is in scope.
			// False rather than undefined so the field can be required on the type.
			forcedGc: false
		};
	});
}

/**
 * Mark which processes were sampled after a forced garbage collection.
 *
 * By role rather than by pid, even though {@link ForcedGcStats} carries one. The
 * GC reaches a process through its role's inspector port, so every process of a
 * collected role is in the collected state; flagging only the pid that answered
 * would leave a sibling of the same role reading as live. The API's trend
 * summary aggregates this per role with `any()` on exactly that assumption.
 *
 * Absent stats mean no GC pass ran, so every process keeps the `false`
 * {@link joinProcesses} set.
 */
export function withForcedGc(processes: LabeledProcess[], forcedGc: ForcedGcStats[] | undefined): LabeledProcess[] {
	// Typed as strings rather than GcTarget['role'], so the lookup below can ask
	// about any ProcessRole without a cast.
	const collected = new Set<string>((forcedGc ?? []).map(stats => stats.role));
	return processes.map(proc => ({ ...proc, forcedGc: collected.has(proc.processRole) }));
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
 * amount.
 *
 * Returns whether it actually stopped, how long that took, which is worth
 * recording on its own, and the highest total it saw. The peak matters because
 * the startup reclaim can land inside this window rather than after it: see
 * {@link treeHasSettled}, which cannot detect a drop it never observed.
 *
 * `stoppedGrowing` is reported rather than left to the caller to infer from
 * `settleMs`, which cannot express it: see {@link MemorySnapshot.stoppedGrowing}.
 *
 * `options.readTree` exists so the loop can be tested without a live process
 * tree; production callers leave it unset.
 */
export async function waitForSettle(
	rootPid: number,
	options: { pollMs?: number; capMs?: number; readTree?: (pid: number) => Promise<RawProcess[]> } = {}
): Promise<{ stoppedGrowing: boolean; settleMs: number; peakTotalPss: number }> {
	const pollMs = options.pollMs ?? 1000;
	const capMs = options.capMs ?? SETTLE_CAP_MS;
	const readTree = options.readTree ?? readProcessTree;
	const started = Date.now();
	const readings: number[] = [];
	let stoppedGrowing = false;

	while (Date.now() - started < capMs) {
		readings.push(totalPss(await readTree(rootPid)));
		if (isSettled(readings)) {
			stoppedGrowing = true;
			break;
		}
		await new Promise(resolve => setTimeout(resolve, pollMs));
	}
	return {
		stoppedGrowing,
		settleMs: Date.now() - started,
		peakTotalPss: readings.length > 0 ? Math.max(...readings) : 0
	};
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
 * Absolute floor under the relative one. Without it the gpu process trips on every
 * run (~5 MB on an ~86 MB median is 6%), and a warning that always fires is one
 * nobody reads. Set below the 86 MB regression this effort exists to catch.
 */
const UNSTABLE_SPREAD_BYTES = 50 * 1024 * 1024;

/**
 * Whether a series's median describes a real state. One definition for both the
 * sampling loop's exit and the report's warning, so a run cannot stop sampling and
 * then complain that it should not have.
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
 * Whether a process's last {@link TAIL_LENGTH} readings are flat. Only the tail,
 * because every process steps down once during startup and a whole-curve rule
 * would call it unsettled forever.
 */
export function tailIsFlat(samples: number[]): boolean {
	return samples.length >= TAIL_LENGTH && isSteady(samples.slice(-TAIL_LENGTH));
}

/**
 * The startup plateau is flat too: idle holds a steady 559 MB renderer for 20s, and
 * a flatness-only rule stopped there and published it. Requiring a drop from the
 * peak separates "not moving yet" from "done moving". 5% against a measured
 * 12-20% drop, where jitter is ~1%.
 */
const RECLAIM_DROP_FRACTION = 0.05;

/**
 * Whether the tree has reclaimed its startup memory and then stopped moving.
 *
 * The drop is measured on the tree total, where the reclaim is unmissable;
 * flatness per process, because summing hides it (the renderer's step is 45% of
 * the renderer but 13% of the tree). An empty tree is settled: the root is gone.
 */
export function treeHasSettled(samples: RawProcess[][], peakBeforeSampling = 0): boolean {
	if (samples.length < TAIL_LENGTH) {
		return false;
	}
	const totals = samples.map(totalPss);
	// Includes the peak waitForSettle saw, because the reclaim does not reliably
	// wait for sampling to start. An `editors` launch took 11.4s to stop growing
	// (siblings took 4.2s), reclaimed inside that window, and then presented a
	// dead-flat tree for 90s: with the peak taken from sampling alone, latest was
	// the peak, no drop was visible, and the launch burned the cap with every
	// process motionless. Measuring against the earlier peak sees the drop.
	const peak = Math.max(peakBeforeSampling, ...totals);
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
 * invalidates the run.
 *
 * Do NOT read this as a proxy for "the launch hit {@link SAMPLING_CAP_MS}", which
 * an earlier version of this comment claimed. Only the last {@link TAIL_LENGTH}
 * samples are retained, so a launch that sampled to the cap without ever settling
 * still presents a flat tail here and comes back empty. Assert on
 * `snapshot.treeSettled` for that, as memory-scenario.ts does.
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
	lane: MemoryLane;
	rootPid: number;
	buildRoot: string;
	userDataDir: string;
	launchIndex: number;
	extensions: ActivatedExtension[];
	forceGc?: () => Promise<ForcedGcStats[]>;
}): Promise<MemorySnapshot> {
	const { stoppedGrowing, settleMs, peakTotalPss } = await waitForSettle(input.rootPid);

	// Must land after settle, so startup allocation is already done, and before
	// sampling starts, so the reported tail reflects the collected state.
	const forcedGc = input.forceGc ? await input.forceGc() : undefined;

	const samples: RawProcess[][] = [];
	const startedSampling = Date.now();
	let treeSettled = false;
	while (Date.now() - startedSampling < SAMPLING_CAP_MS) {
		if (samples.length > 0) {
			await new Promise(resolve => setTimeout(resolve, SAMPLE_INTERVAL_MS));
		}
		samples.push(await readProcessTree(input.rootPid));
		if (treeHasSettled(samples, peakTotalPss)) {
			treeSettled = true;
			break;
		}
	}
	const sampledMs = Date.now() - startedSampling;

	// Only the flat tail is reported. The head is the startup plateau, and a
	// median taken across the step between them describes neither state.
	const reported = samples.slice(-TAIL_LENGTH);
	const names = await readProcessNames(input.buildRoot, input.userDataDir);
	const joined = joinProcesses(samples[samples.length - 1], names, input.rootPid, reported);
	// Stamped here rather than inside joinProcesses, which is called from the
	// baseline path too and has no view of the GC pass.
	const processes = withForcedGc(joined, forcedGc);

	return {
		scenario: input.scenario,
		lane: input.lane,
		capturedAt: new Date().toISOString(),
		positronVersion: readPositronVersion(input.buildRoot),
		arkVersion: readArkVersion(input.buildRoot),
		launchIndex: input.launchIndex,
		stoppedGrowing,
		settleMs,
		sampledMs,
		treeSettled,
		forcedGc,
		discardedSamples: samples.length - reported.length,
		treeTotalPssBytes: processes.reduce((sum, p) => sum + p.pssBytes, 0),
		processes,
		extensions: input.extensions
	};
}
