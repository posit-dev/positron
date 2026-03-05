/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { execFile } from 'child_process';
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
 * A child process entry from `ps`, with its PID, RSS in bytes, and command.
 */
interface PsEntry {
	pid: number;
	rss: number;
	command: string;
}

/**
 * List all descendant processes of `rootPid` on macOS using `ps`.
 * Returns entries for the root and all descendants.
 */
async function getMacOSProcessTree(rootPid: number): Promise<PsEntry[]> {
	return new Promise((resolve) => {
		// -A: all processes, -o: custom fields. RSS is reported in kilobytes.
		execFile('/bin/ps', ['-A', '-o', 'pid=,ppid=,rss=,command='], (error, stdout) => {
			if (error) {
				resolve([]);
				return;
			}

			// Build a parent -> children map.
			const children = new Map<number, PsEntry[]>();
			const entries = new Map<number, PsEntry>();

			for (const line of stdout.split('\n')) {
				const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
				if (!match) {
					continue;
				}
				const pid = parseInt(match[1], 10);
				const ppid = parseInt(match[2], 10);
				const rss = parseInt(match[3], 10) * 1024; // kB -> bytes
				const command = match[4].trim();
				const entry: PsEntry = { pid, rss, command };
				entries.set(pid, entry);
				if (!children.has(ppid)) {
					children.set(ppid, []);
				}
				children.get(ppid)!.push(entry);
			}

			// BFS from rootPid to collect all descendants.
			const result: PsEntry[] = [];
			const rootEntry = entries.get(rootPid);
			if (rootEntry) {
				result.push(rootEntry);
			}
			const queue = [rootPid];
			while (queue.length > 0) {
				const parentPid = queue.shift()!;
				const kids = children.get(parentPid);
				if (kids) {
					for (const kid of kids) {
						result.push(kid);
						queue.push(kid.pid);
					}
				}
			}

			resolve(result);
		});
	});
}

/**
 * Remote server implementation of IPositronMemoryInfoProvider.
 *
 * On Linux (primary server target), reads /proc for process RSS and uses
 * cgroups-aware system memory. On macOS (dev fallback), uses `ps` to walk
 * the server's process tree and identify extension host children.
 */
export class PositronMemoryUsageServerService implements IPositronMemoryInfoProvider {
	readonly _serviceBrand: undefined;

	async getMemoryInfo(excludePids?: number[]): Promise<IPositronProcessMemoryInfo> {
		let positronProcessMemory: number;
		let extensionHostMemory = 0;

		if (process.platform === 'linux') {
			// Identify extension host children by their command line.
			// Use a Set to deduplicate PIDs that may appear in multiple
			// /task/*/children entries.
			const childPids = await getDirectChildPids(process.pid);
			const extHostPids = new Set<number>();
			for (const childPid of childPids) {
				const cmdline = await readProcCmdline(childPid);
				if (cmdline && cmdline.includes('--type=extensionHost')) {
					extHostPids.add(childPid);
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
			// macOS dev/fallback: use `ps` to walk the process tree.
			const excludeSet = new Set(excludePids ?? []);
			const tree = await getMacOSProcessTree(process.pid);

			// Expand excludeSet to include full subtrees of excluded kernel
			// PIDs (not just the root PID) so descendants are not counted.
			const fullExcludeSet = new Set(excludeSet);
			for (const excludePid of excludeSet) {
				const subtree = await getMacOSProcessTree(excludePid);
				for (const entry of subtree) {
					fullExcludeSet.add(entry.pid);
				}
			}

			positronProcessMemory = 0;
			for (const entry of tree) {
				if (fullExcludeSet.has(entry.pid)) {
					continue;
				}
				if (entry.command.includes('--type=extensionHost')) {
					extensionHostMemory += entry.rss;
				} else {
					positronProcessMemory += entry.rss;
				}
			}
			// Ensure we report at least the current process RSS.
			if (positronProcessMemory === 0) {
				positronProcessMemory = process.memoryUsage().rss;
			}
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
