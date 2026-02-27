/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { app } from 'electron';
import { IPositronMemoryInfoProvider, IPositronProcessMemoryInfo } from '../common/positronMemoryUsage.js';
import { getSystemMemory } from '../node/positronMemoryUsageUtils.js';

/**
 * Electron main-process implementation of IPositronMemoryInfoProvider.
 *
 * Uses app.getAppMetrics() for Positron process memory (which naturally
 * excludes kernel child processes since they are Node.js-spawned, not
 * Electron-managed) and getSystemMemory() for system totals.
 */
export class PositronMemoryUsageMainService implements IPositronMemoryInfoProvider {
	readonly _serviceBrand: undefined;

	async getMemoryInfo(): Promise<IPositronProcessMemoryInfo> {
		// Sum memory across all Electron-managed processes.
		// workingSetSize is in kilobytes.
		const metrics = app.getAppMetrics();
		let positronProcessMemory = 0;
		for (const metric of metrics) {
			positronProcessMemory += metric.memory.workingSetSize * 1024;
		}

		// Get system memory (respects cgroups on Linux)
		let total: number;
		let free: number;
		if (process.platform === 'linux') {
			const systemMem = await getSystemMemory();
			total = systemMem.total;
			free = systemMem.free;
		} else {
			total = os.totalmem();
			free = os.freemem();
		}

		return {
			totalSystemMemory: total,
			freeSystemMemory: free,
			positronProcessMemory,
		};
	}
}
