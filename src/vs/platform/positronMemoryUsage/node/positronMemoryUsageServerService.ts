/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronMemoryInfoProvider, IPositronProcessMemoryInfo } from '../common/positronMemoryUsage.js';
import { getProcessTreeRss, getSystemMemory } from './positronMemoryUsageUtils.js';

/**
 * Remote server implementation of IPositronMemoryInfoProvider.
 *
 * On Linux (primary server target), reads /proc for process RSS and uses
 * cgroups-aware system memory. On macOS (dev fallback), uses process.memoryUsage().rss
 * and os.totalmem()/os.freemem().
 */
export class PositronMemoryUsageServerService implements IPositronMemoryInfoProvider {
	readonly _serviceBrand: undefined;

	async getMemoryInfo(excludePids?: number[]): Promise<IPositronProcessMemoryInfo> {
		let positronProcessMemory: number;

		const exclude = excludePids?.length ? new Set(excludePids) : undefined;

		if (process.platform === 'linux') {
			// Walk the server's process tree via /proc, excluding kernel
			// subtrees to avoid double-counting their self-reported memory.
			positronProcessMemory = await getProcessTreeRss(process.pid, exclude);
		} else {
			// macOS dev/fallback: use process.memoryUsage().rss for the server process
			positronProcessMemory = process.memoryUsage().rss;
		}

		const systemMem = await getSystemMemory();

		return {
			totalSystemMemory: systemMem.total,
			freeSystemMemory: systemMem.free,
			positronProcessMemory,
		};
	}
}
