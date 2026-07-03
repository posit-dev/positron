/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IPositronMcpServerStatus, IPositronMcpService } from '../../../../../platform/positronMcp/common/positronMcp.js';
import { IMcpToolCallAuditEvent, IMcpToolCallStartEvent, McpAuditEvent } from '../../../../../platform/positronMcp/common/positronMcpAudit.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronMcpActivityFeed } from '../../browser/positronMcpActivityFeed.js';
import { IPositronMcpToolService } from '../../browser/positronMcpToolService.js';

describe('PositronMcpActivityFeed', () => {
	// Emitters must live at describe level so the stubs capture the right event
	// references at build() time.
	const activityEmitter = new Emitter<McpAuditEvent>();
	const consentEmitter = new Emitter<boolean>();
	const getStatus = vi.fn<() => Promise<IPositronMcpServerStatus>>();
	const resetConsent = vi.fn();

	const ctx = createTestContainer()
		.stub(IPositronMcpService, { onDidRecordActivity: activityEmitter.event, getStatus })
		.stub(IPositronMcpToolService, {
			onDidChangeAllowAllConsent: consentEmitter.event,
			isAllowAllConsentActive: () => false,
			resetConsent,
		})
		.stub(ILogService, new NullLogService())
		.build();

	function makeStatus(overrides: Partial<IPositronMcpServerStatus> = {}): IPositronMcpServerStatus {
		return {
			running: true,
			port: 43123,
			token: 'test-token',
			sessions: [],
			recentActivity: [],
			...overrides,
		};
	}

	function makeStartEvent(overrides: Partial<IMcpToolCallStartEvent> = {}): IMcpToolCallStartEvent {
		return {
			type: 'tool-call-start',
			callId: 'call-1',
			timestamp: Date.now(),
			sessionId: 'session-1',
			clientName: 'claude-code',
			toolName: 'execute-code',
			...overrides,
		};
	}

	function makeToolCallEvent(overrides: Partial<IMcpToolCallAuditEvent> = {}): IMcpToolCallAuditEvent {
		return {
			type: 'tool-call',
			callId: 'call-1',
			timestamp: Date.now(),
			sessionId: 'session-1',
			clientName: 'claude-code',
			clientVersion: '1.2.3',
			toolName: 'execute-code',
			argsSummary: '{code: "1 + 1"}',
			outcome: 'ok',
			durationMs: 840,
			resultSummary: 'text(12 chars)',
			...overrides,
		};
	}

	/** Create a feed and wait for the constructor's seeding status read. */
	async function createSeededFeed(): Promise<PositronMcpActivityFeed> {
		const feed = ctx.instantiationService.createInstance(PositronMcpActivityFeed);
		await vi.waitFor(() => expect(feed.state.running).toBe(true));
		return feed;
	}

	beforeEach(() => {
		getStatus.mockResolvedValue(makeStatus());
	});

	it('seeds sessions and events from the status snapshot', async () => {
		const seeded = makeToolCallEvent({ callId: 'seeded' });
		getStatus.mockResolvedValue(makeStatus({
			recentActivity: [seeded],
			sessions: [{ sessionId: 'session-1', createdAt: 1, lastActivityAt: 2 }],
		}));

		const feed = ctx.instantiationService.createInstance(PositronMcpActivityFeed);
		try {
			await vi.waitFor(() => expect(feed.state.events).toHaveLength(1));
			expect({
				running: feed.state.running,
				events: feed.state.events,
				sessionIds: feed.state.sessions.map(s => s.sessionId),
				inFlight: feed.state.inFlight,
				allowAll: feed.state.allowAll,
			}).toEqual({
				running: true,
				events: [seeded],
				sessionIds: ['session-1'],
				inFlight: [],
				allowAll: false,
			});
		} finally {
			feed.dispose();
		}
	});

	it('tracks in-flight calls from start events and clears them on completion', async () => {
		const feed = await createSeededFeed();
		try {
			activityEmitter.fire(makeStartEvent({ callId: 'a', timestamp: Date.now() - 200 }));
			activityEmitter.fire(makeStartEvent({ callId: 'b', timestamp: Date.now() - 100, toolName: 'get-plot' }));
			expect(feed.state.inFlight.map(call => call.callId)).toEqual(['a', 'b']);

			activityEmitter.fire(makeToolCallEvent({ callId: 'a' }));
			expect(feed.state.inFlight.map(call => call.callId)).toEqual(['b']);
			expect(feed.state.events.map(event => event.type)).toEqual(['tool-call']);
		} finally {
			feed.dispose();
		}
	});

	it('appends lifecycle events to the feed', async () => {
		const feed = await createSeededFeed();
		try {
			activityEmitter.fire({ type: 'client-identified', timestamp: Date.now(), sessionId: 'session-1', clientName: 'claude-code' });
			expect(feed.state.events.map(event => event.type)).toEqual(['client-identified']);
		} finally {
			feed.dispose();
		}
	});

	it('re-reads the status shortly after activity to reconcile sessions', async () => {
		vi.useFakeTimers();
		try {
			const feed = ctx.instantiationService.createInstance(PositronMcpActivityFeed);
			try {
				await vi.advanceTimersByTimeAsync(0);
				expect(getStatus).toHaveBeenCalledTimes(1);

				activityEmitter.fire(makeToolCallEvent());
				await vi.advanceTimersByTimeAsync(600);
				expect(getStatus).toHaveBeenCalledTimes(2);
			} finally {
				feed.dispose();
			}
		} finally {
			vi.useRealTimers();
		}
	});

	it('reflects allow-all consent changes and delegates resets', async () => {
		const feed = await createSeededFeed();
		try {
			expect(feed.state.allowAll).toBe(false);
			consentEmitter.fire(true);
			expect(feed.state.allowAll).toBe(true);

			feed.resetConsent();
			expect(resetConsent).toHaveBeenCalledTimes(1);
		} finally {
			feed.dispose();
		}
	});

	it('fires onDidChange for every state transition', async () => {
		const feed = await createSeededFeed();
		try {
			const changes = vi.fn();
			const subscription = feed.onDidChange(changes);
			activityEmitter.fire(makeStartEvent());
			activityEmitter.fire(makeToolCallEvent());
			consentEmitter.fire(true);
			expect(changes).toHaveBeenCalledTimes(3);
			subscription.dispose();
		} finally {
			feed.dispose();
		}
	});
});
