/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
};

export type ActivatedExtension = {
	extensionId: string;
	isBuiltin: boolean;
	activationTimeMs: number | null;
	activationEvent: string | null;
};

/** Everything one app launch produced. */
export type MemorySnapshot = {
	scenario: MemoryScenario;
	/** ISO 8601, set when the tree was read. Lets the report reject stale files. */
	capturedAt: string;
	/** e.g. `2026.09.0-35`: version plus build number, from the build's product.json. */
	positronVersion: string;
	launchIndex: number;
	settleMs: number;
	/** How long sampling ran after settling, waiting for every large process to hold steady. */
	sampledMs?: number;
	/**
	 * Samples taken before the tail and thrown away: the startup plateau, before
	 * Chromium reclaimed its startup memory. Non-zero is normal and healthy.
	 */
	discardedSamples?: number;
	treeTotalPssBytes: number;
	processes: LabeledProcess[];
	extensions: ActivatedExtension[];
};
