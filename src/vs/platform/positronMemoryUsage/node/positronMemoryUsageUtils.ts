/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';

/**
 * Detected cgroup version on this system.
 * Cached after first detection since it cannot change at runtime.
 */
const enum CgroupVersion {
	None = 0,
	V1 = 1,
	V2 = 2,
}

let cachedCgroupVersion: CgroupVersion | undefined;

/**
 * Detect which cgroup version (if any) is active on this Linux system.
 */
async function detectCgroupVersion(): Promise<CgroupVersion> {
	if (cachedCgroupVersion !== undefined) {
		return cachedCgroupVersion;
	}

	try {
		await fs.access('/sys/fs/cgroup/memory.max');
		cachedCgroupVersion = CgroupVersion.V2;
		return cachedCgroupVersion;
	} catch {
		// Not cgroup v2
	}

	try {
		await fs.access('/sys/fs/cgroup/memory/memory.limit_in_bytes');
		cachedCgroupVersion = CgroupVersion.V1;
		return cachedCgroupVersion;
	} catch {
		// Not cgroup v1
	}

	cachedCgroupVersion = CgroupVersion.None;
	return cachedCgroupVersion;
}

/**
 * A value of 2^62 or larger in cgroup v1 indicates "unlimited".
 */
const CGROUP_V1_UNLIMITED_THRESHOLD = 2 ** 62;

/**
 * Read a numeric value from a pseudo-file (e.g., cgroup or /proc).
 * Returns undefined if the file cannot be read or parsed.
 */
async function readNumericFile(path: string): Promise<number | undefined> {
	try {
		const content = await fs.readFile(path, 'utf8');
		const trimmed = content.trim();
		if (trimmed === 'max') {
			return undefined; // cgroup v2 "max" means unlimited
		}
		const value = parseInt(trimmed, 10);
		return isNaN(value) ? undefined : value;
	} catch {
		return undefined;
	}
}

/**
 * Parse the output of macOS `vm_stat` to compute available memory.
 *
 * On macOS, os.freemem() only reports "free" pages (completely unused),
 * which is misleadingly low because macOS aggressively uses RAM for file
 * cache. Available memory is better approximated as:
 *   (free + inactive + purgeable) * pageSize
 * This matches how Activity Monitor computes available memory.
 */
async function getMacOSAvailableMemory(): Promise<number | undefined> {
	return new Promise((resolve) => {
		execFile('/usr/bin/vm_stat', (error, stdout) => {
			if (error) {
				resolve(undefined);
				return;
			}

			// vm_stat reports a page size on the first line and then
			// per-category page counts. Parse what we need.
			const lines = stdout.split('\n');

			// First line: "Mach Virtual Memory Statistics: (page size of NNNN bytes)"
			let pageSize = 4096; // default assumption
			const pageSizeMatch = lines[0]?.match(/page size of (\d+) bytes/);
			if (pageSizeMatch) {
				pageSize = parseInt(pageSizeMatch[1], 10);
			}

			let freePages = 0;
			let inactivePages = 0;
			let purgeablePages = 0;
			let speculativePages = 0;

			for (const line of lines) {
				// Each stat line looks like: "Pages free:   123456."
				const match = line.match(/^(.+?):\s+(\d+)\./);
				if (!match) {
					continue;
				}
				const key = match[1].trim();
				const value = parseInt(match[2], 10);
				if (isNaN(value)) {
					continue;
				}
				switch (key) {
					case 'Pages free':
						freePages = value;
						break;
					case 'Pages inactive':
						inactivePages = value;
						break;
					case 'Pages purgeable':
						purgeablePages = value;
						break;
					case 'Pages speculative':
						speculativePages = value;
						break;
				}
			}

			const availableBytes = (freePages + inactivePages + purgeablePages + speculativePages) * pageSize;
			resolve(availableBytes);
		});
	});
}

/**
 * Get system memory (total and free) respecting cgroups on Linux
 * and using vm_stat on macOS for accurate available memory.
 */
export async function getSystemMemory(): Promise<{ total: number; free: number }> {
	if (process.platform === 'linux') {
		const version = await detectCgroupVersion();

		if (version === CgroupVersion.V2) {
			const limit = await readNumericFile('/sys/fs/cgroup/memory.max');
			const current = await readNumericFile('/sys/fs/cgroup/memory.current');
			if (limit !== undefined && current !== undefined) {
				return {
					total: limit,
					free: Math.max(0, limit - current),
				};
			}
		} else if (version === CgroupVersion.V1) {
			const limit = await readNumericFile('/sys/fs/cgroup/memory/memory.limit_in_bytes');
			const usage = await readNumericFile('/sys/fs/cgroup/memory/memory.usage_in_bytes');
			if (limit !== undefined && usage !== undefined && limit < CGROUP_V1_UNLIMITED_THRESHOLD) {
				return {
					total: limit,
					free: Math.max(0, limit - usage),
				};
			}
		}
	}

	if (process.platform === 'darwin') {
		const available = await getMacOSAvailableMemory();
		if (available !== undefined) {
			return {
				total: os.totalmem(),
				free: available,
			};
		}
	}

	// Fallback: use Node.js os module
	return {
		total: os.totalmem(),
		free: os.freemem(),
	};
}

/**
 * Read the RSS (resident set size) of a process from /proc/[pid]/status on Linux.
 * Reads the VmRSS field which reports in kB, avoiding page-size assumptions
 * (Linux supports 4 KB, 16 KB, and 64 KB pages depending on architecture).
 * Returns bytes, or undefined if the file cannot be read.
 */
export async function readProcRss(pid: number): Promise<number | undefined> {
	try {
		const content = await fs.readFile(`/proc/${pid}/status`, 'utf8');
		const match = content.match(/^VmRSS:\s+(\d+)\s+kB$/m);
		if (!match) {
			return undefined;
		}
		return parseInt(match[1], 10) * 1024;
	} catch {
		return undefined;
	}
}

/** Maximum depth to walk when traversing process trees via /proc. */
const MAX_TREE_DEPTH = 10;

/**
 * Get the RSS of a process and all its descendant processes on Linux.
 * Uses an iterative breadth-first walk of /proc/[pid]/task/[tid]/children
 * with a depth limit to avoid unbounded recursion.
 *
 * @param pid The root process ID to start from.
 * @param excludePids Optional set of PIDs whose entire subtrees should be
 *   skipped. This is used to exclude kernel processes that self-report their
 *   memory, avoiding double-counting.
 * @returns Total RSS in bytes.
 */
export async function getProcessTreeRss(pid: number, excludePids?: Set<number>): Promise<number> {
	let totalRss = 0;

	// Work queue of { pid, depth } entries for breadth-first traversal.
	const queue: { pid: number; depth: number }[] = [{ pid, depth: 0 }];

	while (queue.length > 0) {
		const item = queue.shift()!;

		const rss = await readProcRss(item.pid);
		if (rss !== undefined) {
			totalRss += rss;
		}

		// Stop descending if we have reached the depth limit.
		if (item.depth >= MAX_TREE_DEPTH) {
			continue;
		}

		// Discover children from /proc/[pid]/task/[tid]/children.
		try {
			const taskDir = `/proc/${item.pid}/task`;
			const tids = await fs.readdir(taskDir);
			for (const tid of tids) {
				try {
					const childrenContent = await fs.readFile(`${taskDir}/${tid}/children`, 'utf8');
					const childPids = childrenContent.trim().split(/\s+/).filter(s => s.length > 0);
					for (const childPidStr of childPids) {
						const childPid = parseInt(childPidStr, 10);
						if (!isNaN(childPid)) {
							// Skip kernel subtrees that self-report memory
							if (excludePids?.has(childPid)) {
								continue;
							}
							queue.push({ pid: childPid, depth: item.depth + 1 });
						}
					}
				} catch {
					// Child may have exited; ignore
				}
			}
		} catch {
			// /proc/[pid]/task may not exist; ignore
		}
	}

	return totalRss;
}
