/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { promises as fs } from 'fs';

/** Standard page size on Linux (4 KB). Used to convert /proc/[pid]/statm pages to bytes. */
const PAGE_SIZE = 4096;

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
 * Get system memory (total and free) respecting cgroups on Linux.
 * On non-Linux platforms, uses os.totalmem()/os.freemem().
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

	// Fallback: use Node.js os module
	return {
		total: os.totalmem(),
		free: os.freemem(),
	};
}

/**
 * Read the RSS (resident set size) of a process from /proc/[pid]/statm on Linux.
 * Returns bytes, or undefined if the file cannot be read.
 */
export async function readProcRss(pid: number): Promise<number | undefined> {
	try {
		const content = await fs.readFile(`/proc/${pid}/statm`, 'utf8');
		const fields = content.trim().split(/\s+/);
		// Field index 1 is the resident set size in pages
		const residentPages = parseInt(fields[1], 10);
		if (isNaN(residentPages)) {
			return undefined;
		}
		return residentPages * PAGE_SIZE;
	} catch {
		return undefined;
	}
}

/**
 * Get the RSS of a process and all its descendant processes on Linux.
 * Walks /proc/[pid]/task/[tid]/children recursively.
 * Returns total bytes.
 */
export async function getProcessTreeRss(pid: number): Promise<number> {
	let totalRss = 0;

	const selfRss = await readProcRss(pid);
	if (selfRss !== undefined) {
		totalRss += selfRss;
	}

	// Read children from /proc/[pid]/task/[tid]/children
	try {
		const taskDir = `/proc/${pid}/task`;
		const tids = await fs.readdir(taskDir);
		for (const tid of tids) {
			try {
				const childrenContent = await fs.readFile(`${taskDir}/${tid}/children`, 'utf8');
				const childPids = childrenContent.trim().split(/\s+/).filter(s => s.length > 0);
				for (const childPidStr of childPids) {
					const childPid = parseInt(childPidStr, 10);
					if (!isNaN(childPid)) {
						totalRss += await getProcessTreeRss(childPid);
					}
				}
			} catch {
				// Child may have exited; ignore
			}
		}
	} catch {
		// /proc/[pid]/task may not exist; ignore
	}

	return totalRss;
}
