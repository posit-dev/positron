/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Emitter } from '../../../../../base/common/event.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IPositronMcpAggregateStatus, IPositronMcpService, IPositronMcpWindowStatus } from '../../../../../platform/positronMcp/common/positronMcp.js';
import { IMcpToolCallAuditEvent, IMcpToolCallStartEvent, McpAuditEvent } from '../../../../../platform/positronMcp/common/positronMcpAudit.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { PositronMcpActivity } from '../../browser/positronMcpActivity.js';
import { PositronMcpActivityFeed } from '../../browser/positronMcpActivityFeed.js';
import { IPositronMcpToolService } from '../../browser/positronMcpToolService.js';

describe('PositronMcpActivity', () => {
	// Emitters must live at describe level so the stubs capture the right event
	// references at build() time.
	const activityEmitter = new Emitter<McpAuditEvent>();
	const consentEmitter = new Emitter<boolean>();
	const getStatus = vi.fn<() => Promise<IPositronMcpWindowStatus>>();
	const getAggregateStatus = vi.fn<() => Promise<IPositronMcpAggregateStatus>>();
	const resetConsent = vi.fn();

	const ctx = createTestContainer()
		.stub(IPositronMcpService, { onDidRecordActivity: activityEmitter.event, getStatus, getAggregateStatus })
		.stub(IPositronMcpToolService, {
			onDidChangeAllowAllConsent: consentEmitter.event,
			isAllowAllConsentActive: () => false,
			resetConsent,
		})
		.stub(ILogService, new NullLogService())
		.build();
	const rtl = setupRTLRenderer();

	function makeWindowStatus(overrides: Partial<IPositronMcpWindowStatus> = {}): IPositronMcpWindowStatus {
		return {
			running: true,
			port: 43123,
			token: 'test-token',
			sessions: [],
			...overrides,
		};
	}

	function makeAggregateStatus(overrides: Partial<IPositronMcpAggregateStatus> = {}): IPositronMcpAggregateStatus {
		return {
			token: 'test-token',
			sessions: [],
			recentActivity: [],
			claudeCliState: 'unknown',
			...overrides,
		};
	}

	function makeToolCallEvent(overrides: Partial<IMcpToolCallAuditEvent> = {}): IMcpToolCallAuditEvent {
		return {
			type: 'tool-call',
			callId: 'call-1',
			timestamp: Date.now() - 5_000,
			sessionId: 'session-1',
			clientName: 'claude-code',
			clientVersion: '1.2.3',
			toolName: 'execute-code',
			argsSummary: '{code: "1 + 1"}',
			outcome: 'ok',
			durationMs: 840,
			resultSummary: 'text(12 chars)',
			pinnedWindowId: 1,
			...overrides,
		};
	}

	function makeStartEvent(overrides: Partial<IMcpToolCallStartEvent> = {}): IMcpToolCallStartEvent {
		return {
			type: 'tool-call-start',
			callId: 'start-1',
			timestamp: Date.now() - 2_000,
			sessionId: 'session-1',
			clientName: 'claude-code',
			toolName: 'get-plot',
			pinnedWindowId: 1,
			...overrides,
		};
	}

	/** Render the pane over a freshly seeded feed; disposal rides the render cleanup. */
	async function renderActivity(aggregateOverrides: Partial<IPositronMcpAggregateStatus> = {}): Promise<PositronMcpActivityFeed> {
		getStatus.mockResolvedValue(makeWindowStatus());
		getAggregateStatus.mockResolvedValue(makeAggregateStatus(aggregateOverrides));
		const feed = ctx.instantiationService.createInstance(PositronMcpActivityFeed);
		rtl.render(<PositronMcpActivity feed={feed} />);
		await vi.waitFor(() => expect(feed.state.running).toBe(true));
		return feed;
	}

	it('shows the empty state until activity arrives', async () => {
		const feed = await renderActivity();
		expect(await screen.findByText('No agents connected.')).toBeInTheDocument();
		expect(screen.getByText('No MCP activity yet. Tool calls from connected agents will appear here.')).toBeInTheDocument();
		feed.dispose();
	});

	it('renders completed tool calls with client display name and duration', async () => {
		const feed = await renderActivity();
		act(() => {
			activityEmitter.fire(makeToolCallEvent());
		});
		expect(screen.getByText('execute-code')).toBeInTheDocument();
		expect(screen.getByText('Claude Code 1.2.3')).toBeInTheDocument();
		expect(screen.getByText(/840ms/)).toBeInTheDocument();
		feed.dispose();
	});

	it('renders an in-flight spinner row while a call runs', async () => {
		const feed = await renderActivity();
		act(() => {
			activityEmitter.fire(makeStartEvent());
		});
		expect(screen.getByText('get-plot')).toBeInTheDocument();
		expect(screen.getByText(/running \d+s/)).toBeInTheDocument();
		feed.dispose();
	});

	it('renders lifecycle events inline', async () => {
		const feed = await renderActivity();
		act(() => {
			activityEmitter.fire({ type: 'client-identified', timestamp: Date.now(), sessionId: 'session-1', clientName: 'claude-code', clientVersion: '1.2.3', pinnedWindowId: 1 });
		});
		expect(screen.getByText('Claude Code 1.2.3 connected')).toBeInTheDocument();
		feed.dispose();
	});

	it('lists connected sessions in the header', async () => {
		const feed = await renderActivity({
			sessions: [{ sessionId: 'session-1', clientName: 'claude-code', clientVersion: '1.2.3', createdAt: Date.now() - 60_000, lastActivityAt: Date.now() - 10_000, pinnedWindowId: 1 }],
		});
		expect(await screen.findByText('Claude Code 1.2.3')).toBeInTheDocument();
		expect(screen.getByText(/connected .* · active .*/)).toBeInTheDocument();
		feed.dispose();
	});

	it('shows the consent banner and resets consent from it', async () => {
		const user = userEvent.setup();
		const feed = await renderActivity();
		act(() => {
			consentEmitter.fire(true);
		});
		expect(screen.getByText('All agent code execution is allowed for this session.')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Reset' }));
		expect(resetConsent).toHaveBeenCalledTimes(1);
		feed.dispose();
	});

	it('expands a tool-call row to its detail on click', async () => {
		const user = userEvent.setup();
		const feed = await renderActivity();
		act(() => {
			activityEmitter.fire(makeToolCallEvent());
		});

		const row = screen.getByRole('button', { name: /execute-code/ });
		expect(row).toHaveAttribute('aria-expanded', 'false');
		await user.click(row);
		expect(row).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getByText('{code: "1 + 1"}')).toBeInTheDocument();
		expect(screen.getByText('text(12 chars)')).toBeInTheDocument();
		feed.dispose();
	});

	it('filters rows by text and by outcome', async () => {
		const user = userEvent.setup();
		const feed = await renderActivity();
		act(() => {
			activityEmitter.fire(makeToolCallEvent({ callId: 'ok-call', toolName: 'execute-code', outcome: 'ok' }));
			activityEmitter.fire(makeToolCallEvent({ callId: 'err-call', toolName: 'get-plot', outcome: 'error' }));
		});
		expect(screen.getByText('execute-code')).toBeInTheDocument();
		expect(screen.getByText('get-plot')).toBeInTheDocument();

		// Text filter narrows to the matching tool.
		await user.type(screen.getByRole('textbox', { name: 'Filter MCP activity' }), 'execute');
		expect(screen.getByText('execute-code')).toBeInTheDocument();
		expect(screen.queryByText('get-plot')).not.toBeInTheDocument();
		await user.clear(screen.getByRole('textbox', { name: 'Filter MCP activity' }));

		// Outcome chips narrow to failures.
		await user.click(screen.getByRole('button', { name: 'Errors' }));
		expect(screen.queryByText('execute-code')).not.toBeInTheDocument();
		expect(screen.getByText('get-plot')).toBeInTheDocument();
		feed.dispose();
	});
});
