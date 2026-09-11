/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Forces a garbage collection in Positron's Node/V8 processes over the Chrome
 * DevTools Protocol, before a memory snapshot samples them.
 *
 * Both the shared process and the extension host idle after startup with no
 * further allocation, so whether V8 happened to have collected their startup
 * garbage by sampling time is down to GC timing, not the launch itself. That
 * swings the shared process 114-144 MB and the extension host ~40 MB launch to
 * launch. Forcing a GC before sampling converges every launch to within a few
 * MB, which is the only way to make either figure comparable across launches.
 */

import { MemoryLane } from './lanes.js';
import { CdpClient, connectToInspector, defaultConnect, WsConnect } from './cdp.js';

export { WebSocketLike, WsConnect } from './cdp.js';

export interface GcTarget {
	role: 'shared' | 'extension_host';
	label: string;
	port: number;
	flag: string;
}

export const GC_TARGETS: GcTarget[] = [
	{ role: 'shared', label: 'shared process', port: 5879, flag: '--inspect-sharedprocess' },
	{ role: 'extension_host', label: 'extension host', port: 5870, flag: '--inspect-extensions' }
];

/**
 * Which processes to collect in a given lane.
 *
 * The shared process is Electron-only, so the server lane has one target. Its
 * inspector is not opened by a launch flag either: the remote extension host
 * takes its port from the client, over the workbench payload. See the spec's
 * "Forced GC in the server lane".
 */
export function gcTargetsFor(lane: MemoryLane): GcTarget[] {
	return lane === 'server'
		? GC_TARGETS.filter(target => target.role === 'extension_host')
		: GC_TARGETS;
}

/**
 * The workbench payload entry (playwrightBrowser.ts) that opens the remote
 * extension host's inspector port in the server lane, or `undefined` outside
 * it. Derived from `GC_TARGETS` rather than a literal, so the port this
 * requests and the port `gc.ts` itself connects to cannot drift apart.
 */
export function extensionHostInspectPayloadEntry(lane: MemoryLane): [key: string, value: string] | undefined {
	if (lane !== 'server') {
		return undefined;
	}
	const target = GC_TARGETS.find(t => t.role === 'extension_host')!;
	return [target.flag.replace(/^--/, ''), String(target.port)];
}

export interface ForcedGcStats {
	role: GcTarget['role'];
	pid: number;
	preRssBytes: number;
	postRssBytes: number;
	preHeapTotalBytes: number;
	postHeapTotalBytes: number;
}

/**
 * Entries a real CDP reading could never produce: a live process cannot report
 * a zero or negative pid, RSS, or heap total. Anything matching this is not a
 * GC pass that ran, it is a malformed or absent reading masquerading as one.
 *
 * Deliberately does not compare pre/post: a GC that legitimately freed nothing
 * is a valid outcome and must not fail this check.
 */
export function malformedForcedGc(stats: ForcedGcStats[]): ForcedGcStats[] {
	return stats.filter(entry =>
		entry.pid <= 0 || entry.preRssBytes <= 0 || entry.preHeapTotalBytes <= 0);
}

/** The two collectGarbage passes are spaced out so the second can catch what the first's finalizers freed. */
const FIRST_PASS_SETTLE_MS = 3_000;
const SECOND_PASS_SETTLE_MS = 2_000;

type MemoryUsagePayload = { pid: number; mem: { rss: number; heapTotal: number } };

async function readMemoryUsage(client: CdpClient, target: GcTarget): Promise<MemoryUsagePayload> {
	const result = await client.send<{ result: { value: string } }>('Runtime.evaluate', {
		expression: 'JSON.stringify({ pid: process.pid, mem: process.memoryUsage() })',
		returnByValue: true
	});
	try {
		return JSON.parse(result.result.value);
	} catch (error) {
		throw new Error(`${target.label} inspector on port ${target.port} returned an unparseable memoryUsage payload: ${error}`);
	}
}

function wait(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Forces two garbage collection passes in the process reachable at `target`'s
 * CDP endpoint and returns its RSS/heap before and after.
 *
 * Never returns without a real GC having run: any failure along the way
 * (unreachable inspector, a websocket error, a 10s message timeout) throws
 * rather than skipping, because a launch this couldn't reach is not a launch
 * whose figure can be trusted.
 */
export async function collectGarbageIn(
	target: GcTarget,
	connect: WsConnect = defaultConnect,
	fetchImpl: typeof fetch = fetch
): Promise<ForcedGcStats> {
	const { port } = target;
	try {
		const client = await connectToInspector(port, target.label, connect, fetchImpl);
		try {
			const pre = await readMemoryUsage(client, target);

			await client.send('HeapProfiler.enable');
			await client.send('HeapProfiler.collectGarbage');
			await wait(FIRST_PASS_SETTLE_MS);
			// A second pass catches objects only freed by the first pass's finalizers.
			await client.send('HeapProfiler.collectGarbage');
			await wait(SECOND_PASS_SETTLE_MS);

			const post = await readMemoryUsage(client, target);

			return {
				role: target.role,
				pid: pre.pid,
				preRssBytes: pre.mem.rss,
				postRssBytes: post.mem.rss,
				preHeapTotalBytes: pre.mem.heapTotal,
				postHeapTotalBytes: post.mem.heapTotal
			};
		} finally {
			client.close();
		}
	} catch (error) {
		if (error instanceof Error && error.message.includes(`port ${port}`)) {
			throw error;
		}
		throw new Error(
			`${target.label} inspector on port ${port} was unreachable, or forcing a GC through it failed: ${error}`);
	}
}

/**
 * Runs {@link collectGarbageIn} against every target in parallel, so the
 * 3s/2s GC-settle waits are paid once per launch rather than once per target.
 *
 * A failure in any one target rejects the whole call: the hard gate stays,
 * because a launch this couldn't reach for one process is not a launch either
 * process's figure can be trusted from.
 */
export async function collectAllGarbage(targets: GcTarget[] = GC_TARGETS): Promise<ForcedGcStats[]> {
	return Promise.all(targets.map(target => collectGarbageIn(target)));
}
