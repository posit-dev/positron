/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { RawProcess } from './types.js';

const KB = 1024;

/**
 * Read Pss and Rss out of /proc/<pid>/smaps_rollup. We use Pss as the primary
 * figure because it splits shared pages between the processes mapping them,
 * which makes it safe to sum across a tree. Summing Rss would charge the
 * Electron framework in full to every process that maps it.
 */
export function parseSmapsRollup(text: string): { pssBytes: number; rssBytes: number } {
	const read = (field: string): number => {
		// Anchored so Pss does not also match Pss_Dirty or Pss_Anon.
		const match = text.match(new RegExp(`^${field}:\\s+(\\d+) kB$`, 'm'));
		return match ? parseInt(match[1], 10) * KB : 0;
	};
	return { pssBytes: read('Pss'), rssBytes: read('Rss') };
}

export function parsePpid(statusText: string): number {
	const match = statusText.match(/^PPid:\s+(\d+)$/m);
	return match ? parseInt(match[1], 10) : 0;
}

async function readOrEmpty(path: string): Promise<string> {
	try {
		return await fs.readFile(path, 'utf8');
	} catch {
		// Processes come and go while we walk /proc. A vanished process is
		// normal, not an error.
		return '';
	}
}

/**
 * Breadth-first walk of rootPid and its descendants, root first.
 *
 * Separated from the reading so it can be tested with a synthetic map: this is
 * the only stateful part of this file, and the part with edge cases worth pinning
 * (an absent root, a cycle, processes that are not descendants).
 */
export function buildTree(all: Map<number, RawProcess>, rootPid: number): RawProcess[] {
	const childrenOf = new Map<number, number[]>();
	for (const proc of all.values()) {
		const siblings = childrenOf.get(proc.ppid) ?? [];
		siblings.push(proc.pid);
		childrenOf.set(proc.ppid, siblings);
	}

	const result: RawProcess[] = [];
	const queue = [rootPid];
	const seen = new Set<number>();
	while (queue.length > 0) {
		const pid = queue.shift()!;
		if (seen.has(pid)) {
			continue;
		}
		seen.add(pid);
		const proc = all.get(pid);
		if (proc) {
			result.push(proc);
			queue.push(...(childrenOf.get(pid) ?? []));
		}
	}
	return result;
}

async function readProcess(pid: number): Promise<RawProcess | undefined> {
	// The three reads for one pid are independent, and so are the pids. Issuing
	// them together keeps the whole sweep to roughly one round of I/O rather than
	// 3xN sequential reads, which matters because this runs once a second during
	// settle detection and a slow sweep smears the snapshot across a changing tree.
	const [status, rawCmd, rollup] = await Promise.all([
		readOrEmpty(`/proc/${pid}/status`),
		readOrEmpty(`/proc/${pid}/cmdline`),
		readOrEmpty(`/proc/${pid}/smaps_rollup`)
	]);
	if (!status) {
		return undefined;
	}
	const { pssBytes, rssBytes } = parseSmapsRollup(rollup);
	return {
		pid,
		ppid: parsePpid(status),
		// /proc/<pid>/cmdline separates arguments with NUL bytes.
		cmd: rawCmd.replace(/\0/g, ' ').trim(),
		pssBytes,
		rssBytes
	};
}

/**
 * Walk every descendant of rootPid, returning the root first.
 *
 * Reads all of /proc once and builds the parent map in memory rather than
 * recursing with repeated directory listings, so the snapshot is close to
 * instantaneous and less likely to catch the tree mid-change.
 */
export async function readProcessTree(rootPid: number): Promise<RawProcess[]> {
	const entries = await fs.readdir('/proc');
	const pids = entries.map(e => parseInt(e, 10)).filter(pid => !isNaN(pid));

	const read = await Promise.all(pids.map(pid => readProcess(pid)));
	const all = new Map<number, RawProcess>();
	for (const proc of read) {
		if (proc) {
			all.set(proc.pid, proc);
		}
	}

	return buildTree(all, rootPid);
}
