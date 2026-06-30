/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { JsonRpcMessage } from '../../../../base/common/jsonRpcProtocol.js';
import { NullLogger } from '../../../log/common/log.js';
import { IMcpCallToolResult } from '../../common/positronMcpTools.js';
import { PositronMcpSession } from '../../node/positronMcpSession.js';
import { IPositronMcpToolBroker } from '../../node/positronMcpToolBroker.js';

const initializeRequest: JsonRpcMessage = {
	jsonrpc: '2.0', id: 1, method: 'initialize',
	params: { clientInfo: { name: 'test', version: '1' } },
};

/** A controllable fake broker: tracks which window each invoke targeted. */
class FakeBroker implements IPositronMcpToolBroker {
	target: number | undefined = 1;
	connected = new Set<number>([1]);
	readonly invocations: { windowId: number; name: string }[] = [];
	failNext = false;

	resolveTargetWindow(): number | undefined {
		return this.target;
	}
	isWindowConnected(windowId: number): boolean {
		return this.connected.has(windowId);
	}
	async invokeTool(windowId: number, name: string): Promise<IMcpCallToolResult> {
		if (this.failNext) {
			this.failNext = false;
			throw new Error('window closed mid-call');
		}
		this.invocations.push({ windowId, name });
		return { content: [{ type: 'text', text: `ran ${name} in ${windowId}` }] };
	}
}

/** Build an initialized session bound to the given fake broker. */
async function initializedSession(broker: IPositronMcpToolBroker): Promise<PositronMcpSession> {
	const session = new PositronMcpSession('s', new NullLogger(), broker);
	await session.handleIncoming(initializeRequest);
	return session;
}

async function callGetSession(session: PositronMcpSession): Promise<IMcpCallToolResult> {
	const [response] = await session.handleIncoming({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get-session', arguments: {} } });
	return (response as { result: IMcpCallToolResult }).result;
}

describe('PositronMcpSession window pinning', () => {
	it('routes tool calls to the window pinned at initialize', async () => {
		const broker = new FakeBroker();
		broker.target = 7;
		broker.connected = new Set([7]);
		const session = await initializedSession(broker);

		await callGetSession(session);
		expect(broker.invocations).toEqual([{ windowId: 7, name: 'get-session' }]);
	});

	it('keeps using the pinned window even if the last-active window changes', async () => {
		const broker = new FakeBroker();
		broker.target = 1;
		broker.connected = new Set([1, 2]);
		const session = await initializedSession(broker);

		// Focus moves to window 2, but the session stays pinned to 1.
		broker.target = 2;
		await callGetSession(session);
		await callGetSession(session);
		expect(broker.invocations.map(i => i.windowId)).toEqual([1, 1]);
	});

	it('re-pins to the current last-active window when the pinned one closes', async () => {
		const broker = new FakeBroker();
		broker.target = 1;
		broker.connected = new Set([1]);
		const session = await initializedSession(broker);

		// Pinned window 1 closes; last-active is now 5.
		broker.connected = new Set([5]);
		broker.target = 5;
		await callGetSession(session);
		expect(broker.invocations).toEqual([{ windowId: 5, name: 'get-session' }]);
	});

	it('returns a clean error (no throw) when no window is available', async () => {
		const broker = new FakeBroker();
		broker.target = undefined;
		broker.connected = new Set();
		const session = await initializedSession(broker);

		const result = await callGetSession(session);
		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ type: 'text' });
		expect(broker.invocations).toEqual([]);
	});

	it('surfaces a window-closed-mid-call failure as a tool error, not a transport error', async () => {
		const broker = new FakeBroker();
		broker.target = 1;
		broker.connected = new Set([1]);
		const session = await initializedSession(broker);

		broker.failNext = true;
		const result = await callGetSession(session);
		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('get-session') });
	});
});
