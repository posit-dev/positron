/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { IPositronMemoryInfoProvider, IPositronProcessMemoryInfo } from '../common/positronMemoryUsage.js';
import { getProcessTreeRss, getSystemMemory } from './positronMemoryUsageUtils.js';

/**
 * Read the command line of a process from /proc/[pid]/cmdline on Linux.
 * Returns the raw arguments joined by spaces, or undefined if unreadable.
 */
async function readProcCmdline(pid: number): Promise<string | undefined> {
	try {
		const content = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8');
		// cmdline uses NUL bytes as separators
		return content.replace(/\0/g, ' ').trim();
	} catch {
		return undefined;
	}
}

/**
 * Find direct child PIDs of a process on Linux by reading
 * /proc/[pid]/task/[tid]/children.
 */
async function getDirectChildPids(pid: number): Promise<number[]> {
	const children: number[] = [];
	try {
		const taskDir = `/proc/${pid}/task`;
		const tids = await fs.readdir(taskDir);
		for (const tid of tids) {
			try {
				const content = await fs.readFile(`${taskDir}/${tid}/children`, 'utf8');
				const pids = content.trim().split(/\s+/).filter(s => s.length > 0);
				for (const childPidStr of pids) {
					const childPid = parseInt(childPidStr, 10);
					if (!isNaN(childPid)) {
						children.push(childPid);
					}
				}
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore
	}
	return children;
}

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
		let extensionHostMemory = 0;

		if (process.platform === 'linux') {
			// Identify extension host children by their command line.
			const childPids = await getDirectChildPids(process.pid);
			const extHostPids: number[] = [];
			for (const childPid of childPids) {
				const cmdline = await readProcCmdline(childPid);
				if (cmdline && cmdline.includes('--type=extensionHost')) {
					extHostPids.push(childPid);
				}
			}

			// Build the full exclusion set: kernel PIDs + extension host PIDs.
			const allExclude = new Set<number>();
			if (excludePids?.length) {
				for (const pid of excludePids) {
					allExclude.add(pid);
				}
			}
			for (const pid of extHostPids) {
				allExclude.add(pid);
			}

			const exclude = allExclude.size > 0 ? allExclude : undefined;

			// Walk the server's process tree via /proc, excluding kernel
			// and extension host subtrees to avoid double-counting.
			positronProcessMemory = await getProcessTreeRss(process.pid, exclude);

			// Walk extension host subtrees separately.
			for (const pid of extHostPids) {
				extensionHostMemory += await getProcessTreeRss(pid);
			}
		} else {
			// macOS dev/fallback: use process.memoryUsage().rss for the server process
			positronProcessMemory = process.memoryUsage().rss;
		}

		const systemMem = await getSystemMemory();

		return {
			totalSystemMemory: systemMem.total,
			freeSystemMemory: systemMem.free,
			positronProcessMemory,
			extensionHostMemory,
		};
	}
}
