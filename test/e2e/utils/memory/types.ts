/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ForcedGcStats } from './gc.js';
import { MemoryLane } from './lanes.js';
import { MemoryScenario } from './scenarios.js';

/**
 * Grouping key for memory attribution. Deliberately a small, fixed vocabulary:
 * the dashboard groups on it, so anything high-cardinality (a window title, a
 * pid) belongs in `processName` instead.
 *
 * There is no `utility_other`. Anything we cannot classify becomes `unlabeled`,
 * and a second bucket that nothing can emit would only blur the grouping.
 */
export type ProcessRole =
	| 'main'
	| 'renderer'
	| 'gpu'
	| 'network'
	| 'shared'
	| 'extension_host'
	| 'pty_host'
	| 'file_watcher'
	| 'agent_host'
	| 'kernel_supervisor'
	| 'kernel'
	| 'language_server'
	| 'extension_child'
	| 'zygote'
	| 'shell'
	| 'unlabeled';

/** One process as read from procfs, before naming or labeling. */
export type RawProcess = {
	pid: number;
	ppid: number;
	cmd: string;
	pssBytes: number;
	rssBytes: number;
};

/** One process after joining with Positron's names and resolving a role. */
export type LabeledProcess = {
	pid: number;
	ppid: number;
	depth: number;
	processName: string;
	processRole: ProcessRole;
	labeled: boolean;
	cmdBasename: string;
	/** Median across `pssSamples`. */
	pssBytes: number;
	/** Median across `rssSamples`, so it cannot disagree with `pssBytes` about which instant it describes. */
	rssBytes: number;
	pssMin: number;
	pssMax: number;
	/**
	 * Every reading taken during the sampling window, oldest first, one sample
	 * per SAMPLE_INTERVAL_MS.
	 *
	 * Kept rather than collapsed to a median because the median alone cannot say
	 * whether a process was steady or mid-swing, and publishing the midpoint of a
	 * moving process as a steady-state figure is how a 130 MB renderer drop got
	 * reported as a settled number.
	 */
	pssSamples: number[];
	/** Index-aligned with `pssSamples`, so `pssSamples[i] <= rssSamples[i]` per instant. */
	rssSamples: number[];
	/**
	 * Whether this process was sampled after a forced garbage collection (`gc.ts`).
	 *
	 * Per process rather than a role list on the snapshot, so every band on the
	 * dashboard's Memory by Process Role chart is self-describing: the lane
	 * difference -- the server lane collects only the extension host -- needs no
	 * rule anywhere downstream, and the CSV export and any ad-hoc query get the
	 * column for free. Matches how `labeled` already works on this type.
	 *
	 * Required rather than optional, so a process that never passed through
	 * `withForcedGc` is a compile error rather than a silently un-flagged band.
	 */
	forcedGc: boolean;
};

export type ActivatedExtension = {
	extensionId: string;
	isBuiltin: boolean;
	activationTimeMs: number | null;
	activationEvent: string | null;
};

/** One extension's share of the extension host heap. */
export type ExtensionHeap = {
	/** Real extension id, or the directory name if package.json was unreadable. */
	extensionId: string;
	/** Retained bytes, as a dominator-tree partition of the reachable heap. */
	retainedBytes: number;
};

/**
 * A partition of the extension host's reachable heap by owning extension.
 *
 * Not the same thing as `MemorySnapshot.extensions`, which is the activation-log
 * inventory of what loaded. This is how much of the heap each one retains, so an
 * extension can appear in one and not the other.
 */
export type ExtensionHeapBreakdown = {
	extensions: ExtensionHeap[];
	/** Extension host runtime and node internals. Not any extension's. */
	unattributedBytes: number;
	/** Reachable heap total; extensions + unattributed must equal this. */
	reachableBytes: number;
};

/**
 * Why a launch has no heap breakdown, or `ok` when it does.
 *
 * A closed set: the dashboard switches on these, so a new value is a contract
 * change. Distinguishing them from a missing key matters -- an omitted
 * `extension_heap` means the run predates the feature, not that it failed.
 */
export type ExtensionHeapStatus =
	| 'ok'
	| 'capture_failed'
	| 'parse_failed'
	| 'unsupported_format'
	| 'untrusted';

/** Everything one app launch produced. */
export type MemorySnapshot = {
	scenario: MemoryScenario;
	/** Which process tree this measured. Part of the published series key. */
	lane: MemoryLane;
	/** ISO 8601, set when the tree was read. Lets the report reject stale files. */
	capturedAt: string;
	/** e.g. `2026.09.0-35`: version plus build number, from the build's product.json. */
	positronVersion: string;
	launchIndex: number;
	/**
	 * Whether the tree stopped growing before `waitForSettle` hit its cap. Recorded
	 * rather than inferred from `settleMs`, which cannot tell the two apart: the cap
	 * is only checked before a reading, so a tree going flat just under it returns
	 * the same `settleMs` as one that never settled. Undefined on a baseline.
	 */
	stoppedGrowing?: boolean;
	/** How long the tree took to stop growing. */
	settleMs: number;
	/** How long sampling ran after settling, waiting for every large process to hold steady. */
	sampledMs?: number;
	/**
	 * The same outcome for the sampling phase: whether it stopped because every large
	 * process held steady rather than because it hit its cap. `sampledMs` cannot tell
	 * those apart either, since an iteration starting just under the cap sleeps past
	 * it before settling.
	 */
	treeSettled?: boolean;
	/**
	 * Forced-GC readings for the Node-side processes (shared process, extension
	 * host), taken after settle and before sampling. Pre/post pairs preserve the
	 * un-collected state.
	 */
	forcedGc?: ForcedGcStats[];
	/**
	 * Which ark the build bundles, e.g. `0.1.252+209.885fac4`. Undefined when the
	 * build shipped no sidecar to read it from.
	 *
	 * On the snapshot rather than read at publish time because the report and
	 * publish step is a separate `npx playwright test` invocation that reads these
	 * files back off disk -- the app and its build are long gone by then.
	 */
	arkVersion?: string;
	/**
	 * Samples taken before the tail and thrown away: the startup plateau, before
	 * Chromium reclaimed its startup memory. Non-zero is normal and healthy.
	 */
	discardedSamples?: number;
	treeTotalPssBytes: number;
	processes: LabeledProcess[];
	extensions: ActivatedExtension[];
	/**
	 * Per-extension partition of the extension host heap. Written by the render
	 * step, not at capture time: the parse needs several GB and must not run
	 * while Positron is being sampled. Absent when capture or parsing failed,
	 * which never fails the scenario.
	 */
	extensionHeap?: ExtensionHeapBreakdown;
	/** Set whenever the capture was attempted; absent on runs predating the feature. */
	extensionHeapStatus?: ExtensionHeapStatus;
	/** The extension host pid the capture targeted, even when the capture failed. */
	extensionHeapPid?: number;
};
