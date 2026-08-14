/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { collectAllGarbage, collectGarbageIn, GcTarget, WebSocketLike } from './gc.js';

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

const SHARED_TARGET: GcTarget = { role: 'shared', label: 'shared process', port: 5879, flag: '--inspect-sharedprocess' };
const EXT_HOST_TARGET: GcTarget = { role: 'extension_host', label: 'extension host', port: 5870, flag: '--inspect-extensions' };

describe('collectGarbageIn', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	test('happy path returns role, pid and pre/post stats, and issues two collectGarbage calls', async () => {
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

		const promise = collectGarbageIn(SHARED_TARGET, connect, fakeFetch(5879));
		// Flush the two 3s/2s waits between GC passes.
		await vi.runAllTimersAsync();
		const stats = await promise;

		expect(stats).toEqual({
			role: 'shared',
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

	test('an error reply rejects with a message naming the target\'s port', async () => {
		const socket = new ScriptedSocket((method, id) => ({ id, error: { message: 'boom' } }));
		const connect = vi.fn(async () => socket);

		// Rejects on the first message, before any GC-pacing timer is set, so no
		// timer flush is needed here.
		await expect(collectGarbageIn(EXT_HOST_TARGET, connect, fakeFetch(5870))).rejects.toThrow(/5870/);
	});
});

/**
 * `collectAllGarbage` takes no connect/fetch overrides (it is the real entry
 * point memory-scenario.ts calls), so these tests stub the globals its default
 * `connect`/`fetch` read from, keyed by port so each target reaches its own
 * fake socket.
 */
class GlobalFakeSocket {
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	constructor(private readonly url: string) {
		queueMicrotask(() => this.onopen?.());
	}

	private pidForUrl(): number {
		return Number(new URL(this.url).searchParams.get('pid'));
	}

	send(data: string): void {
		const { id, method } = JSON.parse(data);
		queueMicrotask(() => {
			const result = method === 'Runtime.evaluate'
				? { result: { value: JSON.stringify({ pid: this.pidForUrl(), mem: { rss: 1, heapTotal: 1 } }) } }
				: {};
			this.onmessage?.({ data: JSON.stringify({ id, result }) });
		});
	}

	close(): void { }
}

describe('collectAllGarbage', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	function stubGlobals(fetchMock: typeof fetch): void {
		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal('WebSocket', GlobalFakeSocket);
	}

	test('collects both targets in parallel and returns results in target order', async () => {
		stubGlobals(vi.fn(async (url: string) => {
			const port = Number(new URL(url).port);
			return { json: async () => [{ webSocketDebuggerUrl: `ws://127.0.0.1/target?pid=${port}` }] };
		}) as unknown as typeof fetch);

		const promise = collectAllGarbage([SHARED_TARGET, EXT_HOST_TARGET]);
		await vi.runAllTimersAsync();
		const results = await promise;

		expect(results.map(r => r.role)).toEqual(['shared', 'extension_host']);
		expect(results.map(r => r.pid)).toEqual([SHARED_TARGET.port, EXT_HOST_TARGET.port]);
	});

	test('a failure in one target rejects the whole call', async () => {
		stubGlobals(vi.fn(async (url: string) => {
			const port = Number(new URL(url).port);
			// The extension host's inspector never lists a debuggable target.
			return { json: async () => (port === EXT_HOST_TARGET.port ? [] : [{ webSocketDebuggerUrl: `ws://127.0.0.1/target?pid=${port}` }]) };
		}) as unknown as typeof fetch);

		// Rejects on the first message from the broken target, before any GC-pacing
		// timer is set, so no timer flush is needed and the rejection is attached
		// before the microtask that produces it runs.
		await expect(collectAllGarbage([SHARED_TARGET, EXT_HOST_TARGET])).rejects.toThrow(/5870/);
	});
});
