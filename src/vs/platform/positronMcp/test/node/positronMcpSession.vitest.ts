/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { JsonRpcMessage } from '../../../../base/common/jsonRpcProtocol.js';
import { NullLogger } from '../../../log/common/log.js';
import { POSITRON_MCP_TOOLS, SERVER_INSTRUCTIONS } from '../../common/positronMcpTools.js';
import { isInitializeMessage, PositronMcpSession, ToolInvoker } from '../../node/positronMcpSession.js';

/** Build a session with a stub tool invoker; returns both for assertions. */
function createSession(invoke?: ToolInvoker) {
	const invokeTool: ToolInvoker = invoke ?? (async name => ({ content: [{ type: 'text', text: `called ${name}` }] }));
	const session = new PositronMcpSession('test-session', new NullLogger(), invokeTool);
	return session;
}

const initializeRequest: JsonRpcMessage = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: { clientInfo: { name: 'test-client', version: '1.0.0' } },
};

describe('PositronMcpSession', () => {
	it('answers initialize with protocol version, server info, and instructions', async () => {
		const session = createSession();
		const [response] = await session.handleIncoming(initializeRequest);
		expect(response).toMatchObject({
			jsonrpc: '2.0',
			id: 1,
			result: {
				protocolVersion: '2025-06-18',
				capabilities: { tools: {} },
				serverInfo: { name: 'positron-mcp-server' },
				instructions: SERVER_INSTRUCTIONS,
			},
		});
	});

	it('lists every tool after initialize', async () => {
		const session = createSession();
		await session.handleIncoming(initializeRequest);
		const [response] = await session.handleIncoming({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
		const result = (response as { result: { tools: { name: string }[] } }).result;
		expect(result.tools.map(t => t.name)).toEqual(POSITRON_MCP_TOOLS.map(t => t.name));
	});

	it('rejects requests before initialize', async () => {
		const session = createSession();
		const [response] = await session.handleIncoming({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
		expect(response).toMatchObject({ id: 9, error: { code: -32600 } });
	});

	it('forwards tools/call to the invoker with name and arguments', async () => {
		const invoke = vi.fn<ToolInvoker>(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
		const session = createSession(invoke);
		await session.handleIncoming(initializeRequest);
		await session.handleIncoming({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get-session', arguments: { foo: 1 } } });
		expect(invoke).toHaveBeenCalledWith('get-session', { foo: 1 });
	});

	it('returns no response for a notification (202 path)', async () => {
		const session = createSession();
		await session.handleIncoming(initializeRequest);
		const responses = await session.handleIncoming({ jsonrpc: '2.0', method: 'notifications/initialized' });
		expect(responses).toEqual([]);
	});

	it('isInitializeMessage detects initialize in single and batch messages', () => {
		expect(isInitializeMessage(initializeRequest)).toBe(true);
		expect(isInitializeMessage([initializeRequest])).toBe(true);
		expect(isInitializeMessage({ jsonrpc: '2.0', id: 5, method: 'tools/list' })).toBe(false);
	});
});
