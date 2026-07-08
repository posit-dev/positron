/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { JsonRpcMessage } from '../../../../base/common/jsonRpcProtocol.js';
import { NullLogger } from '../../../log/common/log.js';
import { IPositronMcpAuditLog, McpAuditEvent } from '../../common/positronMcpAudit.js';
import { McpContextLedger } from '../../common/positronMcpContext.js';
import { IMcpCallToolResult } from '../../common/positronMcpTools.js';
import { PositronMcpSession } from '../../node/positronMcpSession.js';
import { IPositronMcpToolBroker } from '../../node/positronMcpToolBroker.js';

const initializeRequest: JsonRpcMessage = {
	jsonrpc: '2.0', id: 1, method: 'initialize',
	params: { clientInfo: { name: 'test', version: '1' } },
};

/**
 * A controllable fake broker fixed to one window (per-window is the whole
 * point now: there is no target to resolve, only a connected/disconnected
 * toggle for that one window).
 */
class FakeBroker implements IPositronMcpToolBroker {
	connected = true;
	readonly invocations: { windowId: number; name: string }[] = [];
	failNext = false;

	constructor(readonly windowId: number) { }

	isConnected(): boolean {
		return this.connected;
	}
	async invokeTool(name: string): Promise<IMcpCallToolResult> {
		if (this.failNext) {
			this.failNext = false;
			throw new Error('window closed mid-call');
		}
		this.invocations.push({ windowId: this.windowId, name });
		return { content: [{ type: 'text', text: `ran ${name} in ${this.windowId}` }] };
	}
}

/** An audit sink that records events for assertions. */
class RecordingAuditLog implements IPositronMcpAuditLog {
	readonly events: McpAuditEvent[] = [];
	record(event: McpAuditEvent): void { this.events.push(event); }
}

/** Build an initialized session bound to the given fake broker. */
async function initializedSession(broker: FakeBroker, audit: IPositronMcpAuditLog = new RecordingAuditLog()): Promise<PositronMcpSession> {
	const session = new PositronMcpSession('s', new NullLogger(), broker, audit, new McpContextLedger());
	await session.handleIncoming(initializeRequest);
	// The handshake fetches a get-session snapshot for the instructions; drop
	// it so the tests assert only the routing of explicit tool calls.
	broker.invocations.length = 0;
	return session;
}

async function callGetSession(session: PositronMcpSession): Promise<IMcpCallToolResult> {
	const [response] = await session.handleIncoming({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get-session', arguments: {} } });
	return (response as { result: IMcpCallToolResult }).result;
}

describe('PositronMcpSession per-window routing', () => {
	it('routes every tool call to the broker\'s fixed window', async () => {
		const broker = new FakeBroker(7);
		const session = await initializedSession(broker);

		await callGetSession(session);
		await callGetSession(session);
		expect(broker.invocations).toEqual([{ windowId: 7, name: 'get-session' }, { windowId: 7, name: 'get-session' }]);
	});

	it('returns a clean error (no throw) when the window is not connected', async () => {
		const broker = new FakeBroker(3);
		broker.connected = false;
		const audit = new RecordingAuditLog();
		const session = await initializedSession(broker, audit);

		const result = await callGetSession(session);
		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ type: 'text' });
		expect(broker.invocations).toEqual([]);
		// The window id is still known and recorded even though it's disconnected --
		// there is nothing to guess, unlike the old last-active-window heuristic.
		expect(audit.events.filter(e => e.type === 'tool-call'))
			.toEqual([expect.objectContaining({ outcome: 'error', pinnedWindowId: 3 })]);
	});

	it('surfaces a window-closed-mid-call failure as a tool error, not a transport error', async () => {
		const broker = new FakeBroker(1);
		const session = await initializedSession(broker);

		broker.failNext = true;
		const result = await callGetSession(session);
		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('get-session') });
	});
});
