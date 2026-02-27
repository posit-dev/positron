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
}

/**
 * Platform-specific provider that collects OS-level and process-level memory info.
 * Desktop uses Electron's app.getAppMetrics(); remote server reads /proc or uses os.
 */
export interface IPositronMemoryInfoProvider {
	readonly _serviceBrand: undefined;
	getMemoryInfo(): Promise<IPositronProcessMemoryInfo>;
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
	otherProcessesBytes: number;
}

// --- Consumer-facing service ---

/**
 * Service that aggregates memory usage data from all sources and emits periodic snapshots.
 * React components consume this service to render the memory meter.
 */
export interface IPositronMemoryUsageService {
	readonly _serviceBrand: undefined;
	readonly onDidUpdateMemoryUsage: Event<IMemoryUsageSnapshot>;
	readonly currentSnapshot: IMemoryUsageSnapshot | undefined;
}

export const IPositronMemoryUsageService = createDecorator<IPositronMemoryUsageService>('positronMemoryUsageService');
