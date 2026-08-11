/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
	pssBytes: number;
	rssBytes: number;
	pssMin: number;
	pssMax: number;
};

export type ActivatedExtension = {
	extensionId: string;
	isBuiltin: boolean;
	activationTimeMs: number | null;
	activationEvent: string | null;
};

/** Everything one app launch produced. */
export type MemorySnapshot = {
	scenario: 'idle';
	/** ISO 8601, set when the tree was read. Lets the report reject stale files. */
	capturedAt: string;
	launchIndex: number;
	settleMs: number;
	treeTotalPssBytes: number;
	processes: LabeledProcess[];
	extensions: ActivatedExtension[];
};
