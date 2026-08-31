/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WebSocketLike } from './cdp.js';
import { captureExtensionHostHeap, heapSidecarPath, heapSnapshotPath } from './heap-capture.js';

/**
 * Replays the frames a real extension host sends: scriptParsed events during
 * Debugger.enable, then snapshot chunks during takeHeapSnapshot.
 */
class InspectorSocket implements WebSocketLike {
	sent: string[] = [];
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	constructor(
		private readonly scripts: Record<string, string>,
		private readonly chunks: string[],
		private readonly failOn?: string
	) { }

	send(data: string): void {
		const { id, method } = JSON.parse(data);
		this.sent.push(method);
		queueMicrotask(() => {
			if (method === this.failOn) {
				this.emit({ id, error: { message: 'refused' } });
				return;
			}
			if (method === 'Debugger.enable') {
				for (const [scriptId, url] of Object.entries(this.scripts)) {
					this.emit({ method: 'Debugger.scriptParsed', params: { scriptId, url } });
				}
			}
			if (method === 'HeapProfiler.takeHeapSnapshot') {
				for (const chunk of this.chunks) {
					this.emit({ method: 'HeapProfiler.addHeapSnapshotChunk', params: { chunk } });
				}
			}
			this.emit({ id, result: {} });
		});
	}

	private emit(message: object): void {
		this.onmessage?.({ data: JSON.stringify(message) });
	}

	close(): void { }
}

const fakeFetch = () => vi.fn(async () => ({
	json: async () => [{ webSocketDebuggerUrl: 'ws://127.0.0.1/target' }]
})) as unknown as typeof fetch;

describe('captureExtensionHostHeap', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'heap-capture-'));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test('writes the streamed snapshot and a sidecar of script urls', async () => {
		const socket = new InspectorSocket(
			{ '1': 'file:///ext/copilot/main.js' },
			['{"snapshot"', ':{"node_count":1}}']
		);

		const captured = await captureExtensionHostHeap({
			dir, launchIndex: 0, extensionRoots: [],
			connect: async () => socket, fetchImpl: fakeFetch()
		});

		expect(captured.captured).toBe(true);
		expect(readFileSync(heapSnapshotPath(dir, 0), 'utf8')).toBe('{"snapshot":{"node_count":1}}');
		expect(JSON.parse(readFileSync(heapSidecarPath(dir, 0), 'utf8'))).toEqual({
			scriptUrls: { '1': 'file:///ext/copilot/main.js' },
			extensionIds: {}
		});
	});

	test('enables the debugger before taking the snapshot, so the script map is complete', async () => {
		const socket = new InspectorSocket({ '1': 'file:///a.js' }, ['{}']);

		await captureExtensionHostHeap({
			dir, launchIndex: 1, extensionRoots: [],
			connect: async () => socket, fetchImpl: fakeFetch()
		});

		expect(socket.sent.indexOf('Debugger.enable'))
			.toBeLessThan(socket.sent.indexOf('HeapProfiler.takeHeapSnapshot'));
	});

	test('returns false and writes nothing when the inspector refuses', async () => {
		const socket = new InspectorSocket({}, [], 'HeapProfiler.takeHeapSnapshot');

		const captured = await captureExtensionHostHeap({
			dir, launchIndex: 0, extensionRoots: [],
			connect: async () => socket, fetchImpl: fakeFetch()
		});

		expect(captured.captured).toBe(false);
		expect(existsSync(heapSnapshotPath(dir, 0))).toBe(false);
	});

	test('returns false rather than throwing when the inspector is unreachable', async () => {
		const captured = await captureExtensionHostHeap({
			dir, launchIndex: 0, extensionRoots: [],
			connect: async () => { throw new Error('ECONNREFUSED'); },
			fetchImpl: fakeFetch()
		});

		expect(captured.captured).toBe(false);
	});

	test('returns false when the inspector streamed no chunks', async () => {
		const socket = new InspectorSocket({ '1': 'file:///a.js' }, []);

		const captured = await captureExtensionHostHeap({
			dir, launchIndex: 0, extensionRoots: [],
			connect: async () => socket, fetchImpl: fakeFetch()
		});

		expect(captured.captured).toBe(false);
		expect(existsSync(heapSnapshotPath(dir, 0))).toBe(false);
	});
});
