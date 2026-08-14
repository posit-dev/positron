/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { collectSharedProcessGarbage, WebSocketLike } from './gc.js';

/** Records every method sent, and lets the test script a reply per call. */
class ScriptedSocket implements WebSocketLike {
	sent: string[] = [];
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	constructor(private readonly reply: (method: string, id: number) => object) { }

	send(data: string): void {
		const { id, method } = JSON.parse(data);
		this.sent.push(method);
		// Real CDP replies arrive asynchronously; queue on a microtask so callers
		// have already registered their pending promise before it resolves.
		queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(this.reply(method, id)) }));
	}

	close(): void { }
}

function fakeFetch(port: number): typeof fetch {
	const response = { json: async () => [{ webSocketDebuggerUrl: 'ws://127.0.0.1/target' }] };
	return vi.fn(async (url: string | URL) => {
		expect(String(url)).toBe(`http://127.0.0.1:${port}/json`);
		return response;
	}) as unknown as typeof fetch;
}

describe('collectSharedProcessGarbage', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	test('happy path returns pid and pre/post stats, and issues two collectGarbage calls', async () => {
		let memCall = 0;
		const socket = new ScriptedSocket((method, id) => {
			if (method === 'Runtime.evaluate') {
				memCall++;
				const mem = memCall === 1
					? { rss: 200_000_000, heapTotal: 100_000_000 }
					: { rss: 150_000_000, heapTotal: 80_000_000 };
				return { id, result: { result: { value: JSON.stringify({ pid: 4242, mem }) } } };
			}
			return { id, result: {} };
		});
		const connect = vi.fn(async () => socket);

		const promise = collectSharedProcessGarbage(5879, connect, fakeFetch(5879));
		// Flush the two 3s/2s waits between GC passes.
		await vi.runAllTimersAsync();
		const stats = await promise;

		expect(stats).toEqual({
			pid: 4242,
			preRssBytes: 200_000_000,
			postRssBytes: 150_000_000,
			preHeapTotalBytes: 100_000_000,
			postHeapTotalBytes: 80_000_000
		});
		expect(socket.sent.filter(m => m === 'HeapProfiler.collectGarbage')).toHaveLength(2);
		expect(socket.sent).toEqual([
			'Runtime.evaluate', 'HeapProfiler.enable', 'HeapProfiler.collectGarbage', 'HeapProfiler.collectGarbage', 'Runtime.evaluate'
		]);
	});

	test('an error reply rejects with a message naming the port', async () => {
		const socket = new ScriptedSocket((method, id) => ({ id, error: { message: 'boom' } }));
		const connect = vi.fn(async () => socket);

		// Rejects on the first message, before any GC-pacing timer is set, so no
		// timer flush is needed here.
		await expect(collectSharedProcessGarbage(5879, connect, fakeFetch(5879))).rejects.toThrow(/5879/);
	});
});
