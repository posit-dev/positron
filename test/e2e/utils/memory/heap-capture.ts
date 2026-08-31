/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Streams a V8 heap snapshot out of the extension host, for
 * `heap-attribute.ts` to partition later.
 *
 * Capture only. Parsing a 354 MB snapshot needs several GB of heap, which
 * cannot run inside the container while Positron is being measured, so the
 * file is written here and read back in the render step.
 */

import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CdpClient, connectToInspector, defaultConnect, MESSAGE_TIMEOUT_MS, WsConnect } from './cdp.js';
import { readExtensionIdsByDirectory } from './extensions.js';
import { GC_TARGETS } from './gc.js';

/** Everything the parse needs besides the snapshot itself. */
export type HeapCaptureSidecar = {
	/** scriptId -> script url, from `Debugger.scriptParsed`. */
	scriptUrls: Record<string, string>;
	/** Extension directory name -> real extension id. */
	extensionIds: Record<string, string>;
	/**
	 * The extension host's own pid, self-reported over CDP.
	 *
	 * Exact rather than inferred: it is the process the snapshot was taken
	 * from, so it stays correct even if a scenario ever runs a second
	 * extension host that a name or role match would confuse it with.
	 */
	pid?: number;
};

export type HeapCaptureResult = {
	captured: boolean;
	/** Absent when the inspector was never reached; the caller then falls back. */
	pid?: number;
};

/** The extension host inspector port, taken from `GC_TARGETS` so the two cannot drift. */
const EXTENSION_HOST_PORT = GC_TARGETS.find(target => target.role === 'extension_host')!.port;

/**
 * Streaming a 354 MB snapshot takes about 5 seconds, so this is well above the
 * shared 10s round-trip default but still short enough to fail rather than eat
 * the job's timeout.
 *
 * Applies to the snapshot step alone; `HEAP_CAPTURE_BUDGET_MS` is what a
 * caller sizing a timeout around the whole capture wants.
 */
export const HEAP_CAPTURE_TIMEOUT_MS = 120_000;

/**
 * Worst case for the whole capture: the snapshot, plus the target lookup, the
 * WebSocket handshake and the three other round trips (`Runtime.evaluate`,
 * `Debugger.enable`, `HeapProfiler.enable`), each bounded by the shared
 * message timeout.
 *
 * The measure test's own setTimeout must exceed this, or Playwright times out
 * the test before the capture can fail cleanly on its own and leave the PSS
 * datapoint intact.
 */
export const HEAP_CAPTURE_BUDGET_MS = HEAP_CAPTURE_TIMEOUT_MS + 5 * MESSAGE_TIMEOUT_MS;

export function heapSnapshotPath(dir: string, launchIndex: number): string {
	return join(dir, `heap-${launchIndex}.heapsnapshot`);
}

export function heapSidecarPath(dir: string, launchIndex: number): string {
	return join(dir, `heap-${launchIndex}.meta.json`);
}

/**
 * Captures the extension host heap for one launch. Returns whether it wrote a
 * snapshot.
 *
 * Never throws. PSS is the product of this harness and attribution is an
 * addition, so losing a night's datapoint because an inspector was unreachable
 * would be a bad trade.
 */
export async function captureExtensionHostHeap(input: {
	dir: string;
	launchIndex: number;
	/** Directories holding extension folders: the build's bundled dir and the run's extensions dir. */
	extensionRoots: string[];
	port?: number;
	connect?: WsConnect;
	fetchImpl?: typeof fetch;
}): Promise<HeapCaptureResult> {
	const port = input.port ?? EXTENSION_HOST_PORT;
	let client: CdpClient | undefined;
	let pid: number | undefined;
	try {
		client = await connectToInspector(port, 'extension host', input.connect ?? defaultConnect, input.fetchImpl ?? fetch);

		const scriptUrls: Record<string, string> = {};
		client.on('Debugger.scriptParsed', (params: { scriptId: string; url: string }) => {
			scriptUrls[params.scriptId] = params.url;
		});
		// Appended as they arrive rather than joined at the end: a 354 MB
		// snapshot as one string sits within striking distance of V8's max
		// string length, and this runs while Positron is still live.
		mkdirSync(input.dir, { recursive: true });
		const snapshotPath = heapSnapshotPath(input.dir, input.launchIndex);
		writeFileSync(snapshotPath, '');
		let chunkedChars = 0;
		client.on('HeapProfiler.addHeapSnapshotChunk', (params: { chunk: string }) => {
			appendFileSync(snapshotPath, params.chunk);
			chunkedChars += params.chunk.length;
		});

		// Same call gc.ts already makes against this inspector every night, so
		// the pid is proven readable here rather than assumed. Best effort: the
		// snapshot is the point, and aborting it over a missing pid is the worse
		// trade. The caller falls back to the labeled process tree.
		try {
			const usage = await client.send<{ result: { value: string } }>('Runtime.evaluate', {
				expression: 'JSON.stringify({ pid: process.pid })',
				returnByValue: true
			});
			pid = JSON.parse(usage.result.value).pid;
		} catch {
			// pid stays undefined.
		}

		// Replays a scriptParsed for every already-loaded script. The replay
		// completes before this resolves: measured 2026-08-31 across three
		// sessions against one extension host, all 609 scripts present at the
		// response with none arriving in the following 10 seconds.
		await client.send('Debugger.enable');

		await client.send('HeapProfiler.enable');
		await client.send('HeapProfiler.takeHeapSnapshot',
			{ reportProgress: false, captureNumericValue: false }, HEAP_CAPTURE_TIMEOUT_MS);

		if (chunkedChars === 0) {
			rmSync(snapshotPath, { force: true });
			console.log('[memory] extension host streamed no heap snapshot chunks; skipping the per-extension breakdown');
			return { captured: false, pid };
		}

		const sidecar: HeapCaptureSidecar = {
			scriptUrls,
			extensionIds: await readExtensionIdsByDirectory(input.extensionRoots),
			pid
		};

		writeFileSync(heapSidecarPath(input.dir, input.launchIndex), JSON.stringify(sidecar));
		console.log(`[memory] captured extension host heap for launch ${input.launchIndex}: ${Object.keys(scriptUrls).length} scripts`);
		return { captured: true, pid };
	} catch (error) {
		// A partial snapshot would parse as garbage, so it goes with the failure.
		rmSync(heapSnapshotPath(input.dir, input.launchIndex), { force: true });
		console.log(`[memory] could not capture the extension host heap: ${error}`);
		return { captured: false, pid };
	} finally {
		client?.close();
	}
}
