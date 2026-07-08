/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IProxyIo, PositronMcpProxy } from '../../node/positronMcpProxy.js';

const ENDPOINT = { url: 'http://localhost:43999', token: 'tok-123' };

/** A fetch stub answering with the given status/body/headers per call. */
function fetchStub(responses: { status: number; body?: string; sessionId?: string }[]): { fetch: typeof fetch; calls: { url: string; init: RequestInit }[] } {
	const calls: { url: string; init: RequestInit }[] = [];
	const stub = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init! });
		const next = responses[Math.min(calls.length - 1, responses.length - 1)];
		return new Response(next.body, {
			status: next.status,
			headers: next.sessionId ? { 'mcp-session-id': next.sessionId } : {},
		});
	}) as typeof fetch;
	return { fetch: stub, calls };
}

function collectingIo(fetchImpl: typeof fetch): { io: IProxyIo; lines: string[] } {
	const lines: string[] = [];
	return { io: { fetch: fetchImpl, write: line => lines.push(line) }, lines };
}

describe('PositronMcpProxy connected', () => {
	it('forwards a request with auth and relays the response body', async () => {
		const { fetch, calls } = fetchStub([{ status: 200, body: '{"jsonrpc":"2.0","id":1,"result":{}}', sessionId: 'sess-1' }]);
		const { io, lines } = collectingIo(fetch);
		const proxy = new PositronMcpProxy(ENDPOINT, io);

		await proxy.handleInput('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');

		expect(lines).toEqual(['{"jsonrpc":"2.0","id":1,"result":{}}']);
		const headers = calls[0].init.headers as Record<string, string>;
		expect(headers['authorization']).toBe('Bearer tok-123');
		expect(headers['content-type']).toBe('application/json');
	});

	it('captures the session id from initialize and sends it on later requests', async () => {
		const { fetch, calls } = fetchStub([
			{ status: 200, body: '{"jsonrpc":"2.0","id":1,"result":{}}', sessionId: 'sess-1' },
			{ status: 200, body: '{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}' },
		]);
		const { io } = collectingIo(fetch);
		const proxy = new PositronMcpProxy(ENDPOINT, io);

		await proxy.handleInput('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');

		expect((calls[0].init.headers as Record<string, string>)['mcp-session-id']).toBeUndefined();
		expect((calls[1].init.headers as Record<string, string>)['mcp-session-id']).toBe('sess-1');
	});

	it('stays silent for accepted notifications (202, empty body)', async () => {
		const { fetch } = fetchStub([{ status: 202 }]);
		const { io, lines } = collectingIo(fetch);
		const proxy = new PositronMcpProxy(ENDPOINT, io);

		await proxy.handleInput('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');

		expect(lines).toEqual([]);
	});

	it('synthesizes a JSON-RPC error for an HTTP error on a request', async () => {
		const { fetch } = fetchStub([{ status: 401, body: '{"error":"unauthorized"}' }]);
		const { io, lines } = collectingIo(fetch);
		const proxy = new PositronMcpProxy(ENDPOINT, io);

		await proxy.handleInput('{"jsonrpc":"2.0","id":7,"method":"tools/list"}\n');

		expect(JSON.parse(lines[0])).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32603, message: 'Positron MCP server returned HTTP 401' } });
	});

	it('synthesizes a JSON-RPC error when the server is unreachable', async () => {
		const failingFetch = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
		const { io, lines } = collectingIo(failingFetch);
		const proxy = new PositronMcpProxy(ENDPOINT, io);

		await proxy.handleInput('{"jsonrpc":"2.0","id":3,"method":"tools/list"}\n');

		const parsed = JSON.parse(lines[0]);
		expect(parsed.id).toBe(3);
		expect(parsed.error.code).toBe(-32603);
		expect(parsed.error.message).toContain('unreachable');
	});

	it('deletes the session when stdin ends', async () => {
		const { fetch, calls } = fetchStub([{ status: 200, body: '{"jsonrpc":"2.0","id":1,"result":{}}', sessionId: 'sess-9' }]);
		const { io } = collectingIo(fetch);
		const proxy = new PositronMcpProxy(ENDPOINT, io);

		await proxy.handleInput('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
		await proxy.end();

		expect(calls[1].init.method).toBe('DELETE');
		expect((calls[1].init.headers as Record<string, string>)['mcp-session-id']).toBe('sess-9');
	});
});

describe('PositronMcpProxy disconnected (no endpoint)', () => {
	const neverFetch = (async () => { throw new Error('must not be called'); }) as unknown as typeof fetch;

	it('answers initialize with a zero-tool server and echoes the protocol version', async () => {
		const { io, lines } = collectingIo(neverFetch);
		const proxy = new PositronMcpProxy(undefined, io);

		await proxy.handleInput('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}\n');

		const parsed = JSON.parse(lines[0]);
		expect(parsed.result.protocolVersion).toBe('2025-06-18');
		expect(parsed.result.serverInfo.name).toBe('positron-mcp-proxy');
		expect(parsed.result.instructions).toContain('not reachable');
	});

	it('reports zero tools, answers ping, ignores notifications, and rejects other methods', async () => {
		const { io, lines } = collectingIo(neverFetch);
		const proxy = new PositronMcpProxy(undefined, io);

		await proxy.handleInput([
			'{"jsonrpc":"2.0","method":"notifications/initialized"}',
			'{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
			'{"jsonrpc":"2.0","id":3,"method":"ping"}',
			'{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"execute-code"}}',
			'',
		].join('\n'));

		expect(lines.map(line => JSON.parse(line))).toEqual([
			{ jsonrpc: '2.0', id: 2, result: { tools: [] } },
			{ jsonrpc: '2.0', id: 3, result: {} },
			{ jsonrpc: '2.0', id: 4, error: { code: -32601, message: 'Method not available: tools/call' } },
		]);
	});

	it('end() does not touch the network', async () => {
		const { io } = collectingIo(neverFetch);
		const proxy = new PositronMcpProxy(undefined, io);
		await proxy.end();
	});
});
