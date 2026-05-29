/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

// --- Low-level provider interface (platform-specific) ---

/**
 * Memory information collected from the OS and the current process tree.
 * All values are in bytes.
 */
export interface IPositronProcessMemoryInfo {
	/** Total system memory in bytes. Respects cgroups on Linux. */
	totalSystemMemory: number;
	/** Free system memory in bytes. Respects cgroups on Linux. */
	freeSystemMemory: number;
	/** Memory used by Positron processes (Electron or server) in bytes. */
	positronProcessMemory: number;
	/** Memory used by the extension host process(es) and their children, in bytes. */
	extensionHostMemory: number;
}

/**
 * Platform-specific provider that collects OS-level and process-level memory info.
 * Desktop uses Electron's app.getAppMetrics(); remote server reads /proc or uses os.
 */
export interface IPositronMemoryInfoProvider {
	readonly _serviceBrand: undefined;
	/**
	 * @param excludePids Optional set of kernel PIDs whose subtrees should be
	 *   excluded from the Positron process memory total to avoid double-counting.
	 */
	getMemoryInfo(excludePids?: number[]): Promise<IPositronProcessMemoryInfo>;
}

export const IPositronMemoryInfoProvider = createDecorator<IPositronMemoryInfoProvider>('positronMemoryInfoProvider');

/** IPC channel name for the memory info provider. */
export const POSITRON_MEMORY_INFO_CHANNEL_NAME = 'positronMemoryInfo';

// --- High-level aggregated snapshot ---

/**
 * Memory usage for a single kernel session.
 */
export interface IMemorySessionUsage {
	sessionId: string;
	sessionName: string;
	languageId: string;
	memoryBytes: number;
	/** The OS process ID of the kernel, if known */
	processId?: number;
}

/**
 * The unit in which a low-memory threshold is expressed (and reported back to
 * the user in the warning tooltip).
 */
export const enum LowMemoryUnit {
	Percent = 'percent',
	Megabytes = 'megabytes',
}

/**
 * The configured thresholds below which the system is considered low on memory.
 * A threshold that is undefined or non-positive is treated as disabled.
 */
export interface ILowMemoryThresholds {
	/** Trigger the low-memory state when free memory drops to or below this percentage of total memory. */
	percent?: number;
	/** Trigger the low-memory state when free memory drops to or below this number of megabytes. */
	megabytes?: number;
}

/**
 * Describes a low-memory condition: which threshold was reached and how much
 * memory remains, expressed in the unit of the triggering threshold.
 */
export interface ILowMemoryStatus {
	/** The unit of the threshold that triggered the low-memory state. */
	unit: LowMemoryUnit;
	/** Remaining free memory in the triggering unit (percent: 0-100; megabytes: MB). */
	remaining: number;
}

/**
 * Determine whether the system is in a low-memory state given the amount of
 * free and total memory and the configured thresholds.
 *
 * The low-memory state is attained when the first of the configured thresholds
 * is reached: either free memory drops to or below `percent`% of total memory,
 * or free memory drops to or below `megabytes` MB. When both thresholds are
 * configured and both are reached, the percentage is reported.
 *
 * @returns The low-memory status, or `undefined` when memory is not low.
 */
export function computeLowMemoryStatus(freeBytes: number, totalBytes: number, thresholds: ILowMemoryThresholds): ILowMemoryStatus | undefined {
	// Without valid total memory we have no reliable data; treat as not low.
	if (totalBytes <= 0) {
		return undefined;
	}

	const percentRemaining = (freeBytes / totalBytes) * 100;
	const megabytesRemaining = freeBytes / (1024 * 1024);

	const percentLow = thresholds.percent !== undefined && thresholds.percent > 0 && percentRemaining <= thresholds.percent;
	const megabytesLow = thresholds.megabytes !== undefined && thresholds.megabytes > 0 && megabytesRemaining <= thresholds.megabytes;

	if (percentLow) {
		return { unit: LowMemoryUnit.Percent, remaining: percentRemaining };
	}
	if (megabytesLow) {
		return { unit: LowMemoryUnit.Megabytes, remaining: megabytesRemaining };
	}
	return undefined;
}

/**
 * Aggregated memory usage snapshot combining kernel, Positron, and OS memory.
 * All values in bytes.
 */
export interface IMemoryUsageSnapshot {
	timestamp: number;
	totalSystemMemory: number;
	freeSystemMemory: number;
	kernelSessions: IMemorySessionUsage[];
	kernelTotalBytes: number;
	positronOverheadBytes: number;
	extensionHostOverheadBytes: number;
	otherProcessesBytes: number;
	/** Present only when the system is in a low-memory state. */
	lowMemory?: ILowMemoryStatus;
}

// --- Consumer-facing service ---

/**
 * Service that aggregates memory usage data from all sources and emits periodic snapshots.
 * React components consume this service to render the memory meter.
 */
export interface IPositronMemoryUsageService {
	readonly _serviceBrand: undefined;
	readonly onDidUpdateMemoryUsage: Event<IMemoryUsageSnapshot>;
	readonly onDidChangeEnabled: Event<boolean>;
	readonly enabled: boolean;
	readonly currentSnapshot: IMemoryUsageSnapshot | undefined;
}

export const IPositronMemoryUsageService = createDecorator<IPositronMemoryUsageService>('positronMemoryUsageService');
