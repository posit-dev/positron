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
 * Walk every descendant of rootPid, returning the root first.
 *
 * Reads all of /proc once and builds the parent map in memory rather than
 * recursing with repeated directory listings, so the snapshot is close to
 * instantaneous and less likely to catch the tree mid-change.
 */
export async function readProcessTree(rootPid: number): Promise<RawProcess[]> {
	const entries = await fs.readdir('/proc');
	const pids = entries.map(e => parseInt(e, 10)).filter(pid => !isNaN(pid));

	const all = new Map<number, RawProcess>();
	for (const pid of pids) {
		const status = await readOrEmpty(`/proc/${pid}/status`);
		if (!status) {
			continue;
		}
		const rawCmd = await readOrEmpty(`/proc/${pid}/cmdline`);
		const { pssBytes, rssBytes } = parseSmapsRollup(await readOrEmpty(`/proc/${pid}/smaps_rollup`));
		all.set(pid, {
			pid,
			ppid: parsePpid(status),
			// /proc/<pid>/cmdline separates arguments with NUL bytes.
			cmd: rawCmd.replace(/\0/g, ' ').trim(),
			pssBytes,
			rssBytes
		});
	}

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
