/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CdpClient, connectToInspector, WebSocketLike } from './cdp.js';

class FakeSocket implements WebSocketLike {
	sent: { id: number; method: string; params?: object }[] = [];
	closed = false;
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	send(data: string): void {
		this.sent.push(JSON.parse(data));
	}
	close(): void {
		this.closed = true;
	}
	/** Delivers a raw CDP frame, as the inspector would. */
	deliver(message: object): void {
		this.onmessage?.({ data: JSON.stringify(message) });
	}
}

describe('CdpClient', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	test('resolves a send with the matching response result', async () => {
		const socket = new FakeSocket();
		const client = new CdpClient(socket, 'extension host inspector on port 5870');

		const pending = client.send('HeapProfiler.enable');
		socket.deliver({ id: socket.sent[0].id, result: { ok: true } });

		await expect(pending).resolves.toEqual({ ok: true });
	});

	test('delivers events to subscribers, and does not confuse them with responses', async () => {
		const socket = new FakeSocket();
		const client = new CdpClient(socket, 'extension host inspector on port 5870');
		const seen: unknown[] = [];
		client.on('Debugger.scriptParsed', params => seen.push(params));

		const pending = client.send('Debugger.enable');
		socket.deliver({ method: 'Debugger.scriptParsed', params: { scriptId: '1', url: 'file:///a.js' } });
		socket.deliver({ method: 'Debugger.scriptParsed', params: { scriptId: '2', url: 'file:///b.js' } });
		socket.deliver({ id: socket.sent[0].id, result: {} });
		await pending;

		expect(seen).toEqual([
			{ scriptId: '1', url: 'file:///a.js' },
			{ scriptId: '2', url: 'file:///b.js' }
		]);
	});

	test('an event with no subscriber is ignored rather than throwing', () => {
		const socket = new FakeSocket();
		new CdpClient(socket, 'extension host inspector on port 5870');

		expect(() => socket.deliver({ method: 'Runtime.consoleAPICalled', params: {} })).not.toThrow();
	});

	test('rejects with the context when the inspector returns an error', async () => {
		const socket = new FakeSocket();
		const client = new CdpClient(socket, 'extension host inspector on port 5870');

		const pending = client.send('HeapProfiler.enable');
		socket.deliver({ id: socket.sent[0].id, error: { message: 'nope' } });

		await expect(pending).rejects.toThrow(/port 5870.*nope/);
	});

	test('rejects when no reply arrives within the message timeout', async () => {
		const socket = new FakeSocket();
		const client = new CdpClient(socket, 'extension host inspector on port 5870');

		const pending = client.send('HeapProfiler.enable');
		const assertion = expect(pending).rejects.toThrow(/did not reply to HeapProfiler.enable/);
		await vi.advanceTimersByTimeAsync(10_000);
		await assertion;
	});

	test('a socket error rejects everything still in flight', async () => {
		const socket = new FakeSocket();
		const client = new CdpClient(socket, 'extension host inspector on port 5870');

		const pending = client.send('HeapProfiler.enable');
		socket.onerror?.('boom');

		await expect(pending).rejects.toThrow(/port 5870/);
	});

	test('an unparseable frame is ignored', () => {
		const socket = new FakeSocket();
		new CdpClient(socket, 'extension host inspector on port 5870');

		expect(() => socket.onmessage?.({ data: 'not json' })).not.toThrow();
	});
});

describe('connectToInspector', () => {
	test('connects to the first debuggable target the inspector lists', async () => {
		const socket = new FakeSocket();
		const connect = vi.fn(async () => socket as WebSocketLike);
		const fetchImpl = vi.fn(async () => ({
			json: async () => [{ webSocketDebuggerUrl: 'ws://127.0.0.1/target' }]
		})) as unknown as typeof fetch;

		const client = await connectToInspector(5870, 'extension host', connect, fetchImpl);

		expect(connect).toHaveBeenCalledWith('ws://127.0.0.1/target');
		expect(client).toBeInstanceOf(CdpClient);
	});

	test('throws naming the port when the inspector lists no target', async () => {
		const fetchImpl = vi.fn(async () => ({ json: async () => [] })) as unknown as typeof fetch;

		await expect(connectToInspector(5870, 'extension host', async () => new FakeSocket(), fetchImpl))
			.rejects.toThrow(/port 5870 listed no debuggable target/);
	});
});
