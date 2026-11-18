/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { CDPEvent, CDPRequest, CDPResponse } from '../../../../../platform/browserView/common/cdp/types.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { IBrowserViewCDPService } from '../../../browserView/common/browserView.js';
import { VIEWER_CONTENT_CHANGED_MESSAGE } from '../../browser/previewSurface.js';
import { BrowserViewBridgeSession } from '../../electron-browser/browserViewBridgeSession.js';

describe('BrowserViewBridgeSession', () => {
	const messages = new Emitter<CDPResponse | CDPEvent>();
	const destroyed = new Emitter<void>();
	let sent: string[];
	let groups: { created: number; destroyed: number };
	/** How the page answers a Runtime.evaluate; undefined leaves it unanswered. */
	let evaluate: ((request: CDPRequest) => Omit<CDPResponse, 'id'>) | undefined;

	const ctx = createLightTestContainer()
		.stub(IBrowserViewCDPService, {
			createSessionGroup: async () => { groups.created++; return 'group-1'; },
			destroySessionGroup: async () => { groups.destroyed++; },
			onCDPMessage: () => messages.event,
			onDidDestroy: () => destroyed.event,
			sendCDPMessage: async (_groupId: string, request: CDPRequest) => {
				sent.push(request.sessionId ? `${request.method} @${request.sessionId}` : request.method);
				const answer = (response: Omit<CDPResponse, 'id'>) => queueMicrotask(() => messages.fire({ id: request.id, ...response }));
				switch (request.method) {
					case 'Target.getTargets':
						return answer({
							result: {
								targetInfos: [
									{ targetId: 'other', type: 'page', vscodeBrowserViewId: 'view-2' },
									{ targetId: 'mine', type: 'page', vscodeBrowserViewId: 'view-1' },
								]
							}
						});
					case 'Target.attachToTarget':
						return answer({ result: { sessionId: `session-for-${(request.params as { targetId: string }).targetId}` } });
					case 'Runtime.evaluate': {
						const response = evaluate?.(request);
						return response && answer(response);
					}
				}
			},
		})
		.build();

	beforeEach(() => {
		sent = [];
		groups = { created: 0, destroyed: 0 };
		evaluate = request => ({ result: { result: { value: (request.params as { expression: string }).expression.toUpperCase() } } });
	});

	function createSession(): BrowserViewBridgeSession {
		return ctx.disposables.add(ctx.instantiationService.createInstance(BrowserViewBridgeSession, 'view-1'));
	}

	it('attaches to its view\'s page once, then evaluates scripts there', async () => {
		const session = createSession();

		const results = [await session.evaluate('a'), await session.evaluate('b')];

		expect({ results, sent, groups }).toEqual({
			results: ['A', 'B'],
			sent: ['Target.getTargets', 'Target.attachToTarget', 'Runtime.evaluate @session-for-mine', 'Runtime.evaluate @session-for-mine'],
			groups: { created: 1, destroyed: 0 },
		});
	});

	it('rejects with the page\'s exception', async () => {
		evaluate = () => ({ result: { exceptionDetails: { text: 'Uncaught', exception: { description: 'ReferenceError: x is not defined' } } } });

		await expect(createSession().evaluate('x')).rejects.toThrow('ReferenceError: x is not defined');
	});

	it('reports a call cut off by navigation as a change of content', async () => {
		evaluate = () => ({ error: { code: -32000, message: 'Execution context was destroyed.' } });

		await expect(createSession().evaluate('a')).rejects.toThrow(VIEWER_CONTENT_CHANGED_MESSAGE);
	});

	it('fails waiting calls and reconnects when its group is destroyed', async () => {
		const session = createSession();
		await session.evaluate('a');
		evaluate = undefined;
		const waiting = session.evaluate('b');
		await vi.waitFor(() => expect(sent).toHaveLength(4));

		destroyed.fire();
		await expect(waiting).rejects.toThrow(VIEWER_CONTENT_CHANGED_MESSAGE);
		evaluate = () => ({ result: { result: { value: 'again' } } });

		expect(await session.evaluate('c')).toBe('again');
		expect(groups.created).toBe(2);
	});

	it('destroys its group and fails waiting calls when disposed', async () => {
		const session = createSession();
		await session.evaluate('a');
		evaluate = undefined;
		const waiting = session.evaluate('b');
		await vi.waitFor(() => expect(sent).toHaveLength(4));

		session.dispose();

		await expect(waiting).rejects.toThrow(VIEWER_CONTENT_CHANGED_MESSAGE);
		expect(groups.destroyed).toBe(1);
	});
});
