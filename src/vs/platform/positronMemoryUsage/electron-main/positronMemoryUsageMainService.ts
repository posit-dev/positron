/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { app } from 'electron';
import { IPositronMemoryInfoProvider, IPositronProcessMemoryInfo } from '../common/positronMemoryUsage.js';
import { getProcessTreeRss, getSystemMemory } from '../node/positronMemoryUsageUtils.js';

/**
 * Electron main-process implementation of IPositronMemoryInfoProvider.
 *
 * Uses app.getAppMetrics() for Positron process memory (which naturally
 * excludes kernel child processes since they are Node.js-spawned, not
 * Electron-managed) and getSystemMemory() for system totals.
 *
 * On Linux, extension host memory includes the extension host's child
 * processes (language servers, etc.), found via /proc. Other platforms have
 * no way to find child processes without scanning the whole process table,
 * so only the extension host process itself is counted there.
 */
export class PositronMemoryUsageMainService implements IPositronMemoryInfoProvider {
	readonly _serviceBrand: undefined;

	async getMemoryInfo(excludePids?: number[]): Promise<IPositronProcessMemoryInfo> {
		// Sum memory across all Electron-managed processes.
		// workingSetSize is in kilobytes.
		const metrics = app.getAppMetrics();
		const exclude = excludePids?.length ? new Set(excludePids) : undefined;
		let positronProcessMemory = 0;
		let extensionHostMemory = 0;
		for (const metric of metrics) {
			const bytes = metric.memory.workingSetSize * 1024;
			// Extension host utility processes have a name like
			// "extensionHost-1", "extensionHost-2", etc. (set via the
			// serviceName option passed to utilityProcess.fork()).
			if (metric.type === 'Utility' && metric.name?.startsWith('extensionHost-')) {
				// Kernel subtrees are excluded; kernels report their own memory.
				extensionHostMemory += process.platform === 'linux'
					? await getProcessTreeRss(metric.pid, exclude)
					: bytes;
			} else {
				positronProcessMemory += bytes;
			}
		}

		// Get system memory (respects cgroups on Linux, uses vm_stat on macOS)
		const systemMem = await getSystemMemory();

		return {
			totalSystemMemory: systemMem.total,
			freeSystemMemory: systemMem.free,
			positronProcessMemory,
			extensionHostMemory,
		};
	}
}
