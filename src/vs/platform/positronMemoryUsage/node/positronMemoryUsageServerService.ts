/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronMemoryInfoProvider, IPositronProcessMemoryInfo } from '../common/positronMemoryUsage.js';
import { getProcessTreeRss, getSystemMemory, readProcRss } from './positronMemoryUsageUtils.js';
import { IPositronServerProcessTracker } from './positronServerProcessTracker.js';

/**
 * Remote server implementation of IPositronMemoryInfoProvider.
 *
 * On Linux (primary server target), reads /proc for process RSS and uses
 * cgroups-aware system memory. On macOS (dev fallback), uses process.memoryUsage().rss
 * and os.totalmem()/os.freemem().
 *
 * Uses the process tracker to attribute memory to extension hosts, pty host,
 * and the remaining server processes.
 */
export class PositronMemoryUsageServerService implements IPositronMemoryInfoProvider {
	readonly _serviceBrand: undefined;

	constructor(
		private readonly _processTracker: IPositronServerProcessTracker,
	) { }

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

		// Measure memory for tracked child processes (extension hosts, pty host).
		let extensionsBytes = 0;
		let terminalsBytes = 0;
		const trackedProcesses = this._processTracker.getAll();

		for (const proc of trackedProcesses) {
			let rss: number;
			if (process.platform === 'linux') {
				rss = await getProcessTreeRss(proc.pid, exclude) || 0;
			} else {
				// On macOS we can only cheaply read /proc-style RSS on Linux.
				// Fall back to reading the process's own RSS via readProcRss
				// (which returns undefined on non-Linux), so these will be 0.
				rss = (await readProcRss(proc.pid)) || 0;
			}

			if (proc.name === 'extension-host') {
				extensionsBytes += rss;
			} else if (proc.name === 'pty-host') {
				terminalsBytes += rss;
			}
		}

		const electronOrServerBytes = Math.max(0, positronProcessMemory - extensionsBytes - terminalsBytes);

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
