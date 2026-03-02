/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { app } from 'electron';
import { IPositronMemoryInfoProvider, IPositronProcessMemoryInfo } from '../common/positronMemoryUsage.js';
import { getSystemMemory } from '../node/positronMemoryUsageUtils.js';
import { UtilityProcess } from '../../utilityProcess/electron-main/utilityProcess.js';

/**
 * Electron main-process implementation of IPositronMemoryInfoProvider.
 *
 * Uses app.getAppMetrics() for Positron process memory (which naturally
 * excludes kernel child processes since they are Node.js-spawned, not
 * Electron-managed) and getSystemMemory() for system totals.
 *
 * Breaks down memory by process role: extension hosts, pty host (terminals),
 * and everything else (Electron main, renderer, GPU, etc.).
 */
export class PositronMemoryUsageMainService implements IPositronMemoryInfoProvider {
	readonly _serviceBrand: undefined;

	async getMemoryInfo(_excludePids?: number[]): Promise<IPositronProcessMemoryInfo> {
		// Build a PID -> name lookup from tracked utility processes so we
		// can identify extension-host and pty-host processes in the metrics.
		const pidToName = new Map<number, string>();
		for (const info of UtilityProcess.getAll()) {
			pidToName.set(info.pid, info.name);
		}

		// Sum memory across all Electron-managed processes.
		// workingSetSize is in kilobytes.
		const metrics = app.getAppMetrics();
		let positronProcessMemory = 0;
		let extensionsBytes = 0;
		let terminalsBytes = 0;
		let electronOrServerBytes = 0;

		for (const metric of metrics) {
			const bytes = metric.memory.workingSetSize * 1024;
			positronProcessMemory += bytes;

			const name = pidToName.get(metric.pid) ?? '';
			if (name.startsWith('extension-host')) {
				extensionsBytes += bytes;
			} else if (name === 'pty-host') {
				terminalsBytes += bytes;
			} else {
				electronOrServerBytes += bytes;
			}
		}

		// Get system memory (respects cgroups on Linux, uses vm_stat on macOS)
		const systemMem = await getSystemMemory();

		return {
			totalSystemMemory: systemMem.total,
			freeSystemMemory: systemMem.free,
			positronProcessMemory,
			electronOrServerBytes,
			extensionsBytes,
			terminalsBytes,
		};
	}
}
