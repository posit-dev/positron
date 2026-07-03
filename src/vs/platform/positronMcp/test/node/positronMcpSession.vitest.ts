/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { JsonRpcMessage } from '../../../../base/common/jsonRpcProtocol.js';
import { NullLogger } from '../../../log/common/log.js';
import { IMcpToolCallAuditEvent, IPositronMcpAuditLog, McpAuditEvent } from '../../common/positronMcpAudit.js';
import { GET_GUIDANCE_TOOL } from '../../common/positronMcpGuides.js';
import { IMcpCallToolResult, POSITRON_MCP_TOOLS, SERVER_INSTRUCTIONS } from '../../common/positronMcpTools.js';
import { isInitializeMessage, PositronMcpSession } from '../../node/positronMcpSession.js';
import { IPositronMcpToolBroker } from '../../node/positronMcpToolBroker.js';

/** A broker that always has window 1 available and records tool invocations. */
class StubBroker implements IPositronMcpToolBroker {
	readonly invokeTool = vi.fn(async (_windowId: number, name: string): Promise<IMcpCallToolResult> =>
		({ content: [{ type: 'text', text: `called ${name}` }] }));
	resolveTargetWindow(): number | undefined { return 1; }
	isWindowConnected(): boolean { return true; }
}

/** An audit sink that records events for assertions. */
class RecordingAuditLog implements IPositronMcpAuditLog {
	readonly events: McpAuditEvent[] = [];
	record(event: McpAuditEvent): void { this.events.push(event); }
}

/** Build a session with a stub broker; returns both for assertions. */
function createSession(broker: IPositronMcpToolBroker = new StubBroker(), audit: IPositronMcpAuditLog = new RecordingAuditLog()) {
	return new PositronMcpSession('test-session', new NullLogger(), broker, audit);
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

	it('lists every tool after initialize, including the server-served get-guidance', async () => {
		const session = createSession();
		await session.handleIncoming(initializeRequest);
		const [response] = await session.handleIncoming({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
		const result = (response as { result: { tools: { name: string }[] } }).result;
		expect(result.tools.map(t => t.name)).toEqual([...POSITRON_MCP_TOOLS.map(t => t.name), GET_GUIDANCE_TOOL.name]);
	});

	it('rejects requests before initialize', async () => {
		const session = createSession();
		const [response] = await session.handleIncoming({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
		expect(response).toMatchObject({ id: 9, error: { code: -32600 } });
	});

	it('forwards tools/call to the broker with name, arguments, and caller identity', async () => {
		const broker = new StubBroker();
		const session = createSession(broker);
		await session.handleIncoming(initializeRequest);
		await session.handleIncoming({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get-session', arguments: { foo: 1 } } });
		expect(broker.invokeTool).toHaveBeenCalledWith(1, 'get-session', { foo: 1 },
			{ mcpSessionId: 'test-session', clientName: 'test-client', clientVersion: '1.0.0' });
	});

	it('serves get-guidance from the main process, with no window and no broker call', async () => {
		const broker = new StubBroker();
		broker.resolveTargetWindow = () => undefined;
		broker.isWindowConnected = () => false;
		const audit = new RecordingAuditLog();
		const session = createSession(broker, audit);
		await session.handleIncoming(initializeRequest);

		const [response] = await session.handleIncoming({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get-guidance', arguments: { topic: 'data-analysis-r' } } });
		const result = (response as { result: IMcpCallToolResult }).result;
		expect(result.isError).toBeUndefined();
		expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('# Data analysis in R') });
		expect(broker.invokeTool).not.toHaveBeenCalled();
		// The call still flows through the audit choke point.
		expect(audit.events.filter(e => e.type === 'tool-call')).toEqual([expect.objectContaining({ toolName: 'get-guidance', outcome: 'ok' })]);
	});

	it('returns no response for a notification (202 path)', async () => {
		const session = createSession();
		await session.handleIncoming(initializeRequest);
		const responses = await session.handleIncoming({ jsonrpc: '2.0', method: 'notifications/initialized' });
		expect(responses).toEqual([]);
	});

	it('reports client identity, timestamps, and pinned window via info', async () => {
		vi.useFakeTimers({ now: 1000 });
		try {
			const session = createSession();
			await session.handleIncoming(initializeRequest);
			vi.setSystemTime(5000);
			await session.handleIncoming({ jsonrpc: '2.0', id: 2, method: 'ping' });
			expect(session.info).toEqual({
				sessionId: 'test-session',
				clientName: 'test-client',
				clientVersion: '1.0.0',
				createdAt: 1000,
				lastActivityAt: 5000,
				pinnedWindowId: 1,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('reports an anonymous session before initialize names the client', () => {
		const session = createSession();
		expect(session.info).toMatchObject({
			sessionId: 'test-session',
			clientName: undefined,
			pinnedWindowId: undefined,
		});
	});

	it('records a client-identified audit event at initialize', async () => {
		const audit = new RecordingAuditLog();
		const session = createSession(new StubBroker(), audit);
		await session.handleIncoming(initializeRequest);
		expect(audit.events).toEqual([expect.objectContaining({
			type: 'client-identified',
			sessionId: 'test-session',
			clientName: 'test-client',
			clientVersion: '1.0.0',
			pinnedWindowId: 1,
		})]);
	});

	it('records one start and one completion audit event per tool call, sharing a callId', async () => {
		vi.useFakeTimers({ now: 1000 });
		try {
			const broker = new StubBroker();
			broker.invokeTool.mockImplementation(async () => {
				vi.setSystemTime(1840);
				return { content: [{ type: 'text', text: 'ok' }] };
			});
			const audit = new RecordingAuditLog();
			const session = createSession(broker, audit);
			await session.handleIncoming(initializeRequest);
			audit.events.length = 0;

			await session.handleIncoming({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get-session', arguments: { foo: 1 } } });
			const [start, end] = audit.events;
			expect(start).toMatchObject({ type: 'tool-call-start', toolName: 'get-session', clientName: 'test-client', pinnedWindowId: 1 });
			expect(end).toMatchObject({
				type: 'tool-call',
				toolName: 'get-session',
				clientName: 'test-client',
				clientVersion: '1.0.0',
				outcome: 'ok',
				durationMs: 840,
				pinnedWindowId: 1,
				argsSummary: '{foo: 1}',
				resultSummary: 'text(2 chars)',
			});
			expect(audit.events).toHaveLength(2);
			expect((end as IMcpToolCallAuditEvent).callId).toBe((start as IMcpToolCallAuditEvent).callId);
		} finally {
			vi.useRealTimers();
		}
	});

	it('records an error outcome when the tool result is an error or the broker throws', async () => {
		const erroringBroker = new StubBroker();
		erroringBroker.invokeTool.mockResolvedValue({ content: [{ type: 'text', text: 'boom' }], isError: true });
		const audit1 = new RecordingAuditLog();
		const session1 = createSession(erroringBroker, audit1);
		await session1.handleIncoming(initializeRequest);
		await session1.handleIncoming({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get-plot' } });
		expect(audit1.events.filter(e => e.type === 'tool-call')).toEqual([expect.objectContaining({ outcome: 'error' })]);

		const throwingBroker = new StubBroker();
		throwingBroker.invokeTool.mockRejectedValue(new Error('window closed'));
		const audit2 = new RecordingAuditLog();
		const session2 = createSession(throwingBroker, audit2);
		await session2.handleIncoming(initializeRequest);
		await session2.handleIncoming({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get-plot' } });
		expect(audit2.events.filter(e => e.type === 'tool-call')).toEqual([expect.objectContaining({ outcome: 'error' })]);
	});

	it('summarizes arguments in the audit event without full code values', async () => {
		const code = 'import pandas as pd\n' + 'df = pd.DataFrame()\n'.repeat(50);
		const audit = new RecordingAuditLog();
		const session = createSession(new StubBroker(), audit);
		await session.handleIncoming(initializeRequest);
		await session.handleIncoming({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'execute-code', arguments: { code, languageId: 'python' } } });
		const end = audit.events.find(e => e.type === 'tool-call') as IMcpToolCallAuditEvent;
		expect(end.argsSummary).toContain('code: "import pandas as pd\\n');
		expect(end.argsSummary).toContain('languageId: "python"');
		expect(end.argsSummary.length).toBeLessThan(300);
		// The complete arguments ride along for the server's JSONL file sink,
		// which strips them unless the audit detail setting is 'full'.
		expect(end.args).toEqual({ code, languageId: 'python' });
	});

	it('isInitializeMessage detects initialize in single and batch messages', () => {
		expect(isInitializeMessage(initializeRequest)).toBe(true);
		expect(isInitializeMessage([initializeRequest])).toBe(true);
		expect(isInitializeMessage({ jsonrpc: '2.0', id: 5, method: 'tools/list' })).toBe(false);
	});
});
