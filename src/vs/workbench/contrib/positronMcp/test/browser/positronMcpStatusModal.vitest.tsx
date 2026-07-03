/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IMcpSessionInfo } from '../../../../../platform/positronMcp/common/positronMcp.js';
import { IMcpToolCallAuditEvent } from '../../../../../platform/positronMcp/common/positronMcpAudit.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { connectSnippet, IMcpStatusData, McpStatusContent } from '../../browser/positronMcpStatusModal.js';

describe('McpStatusContent', () => {
	const rtl = setupRTLRenderer();

	/** A fully set-up, running status; individual tests override what they exercise. */
	function makeStatus(overrides: Partial<IMcpStatusData> = {}): IMcpStatusData {
		return {
			enabled: true,
			running: true,
			port: 43123,
			workspaceConfig: 'configured',
			sessions: [],
			recentActivity: [],
			allowAllConsent: false,
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
			argsSummary: '{languageId: "python"}',
			outcome: 'ok',
			durationMs: 840,
			pinnedWindowId: 1,
			resultSummary: 'text(12 chars)',
			...overrides,
		};
	}

	function makeSession(overrides: Partial<IMcpSessionInfo> = {}): IMcpSessionInfo {
		return {
			sessionId: 'session-1',
			clientName: 'claude-code',
			clientVersion: '1.2.3',
			createdAt: Date.now() - 60_000,
			lastActivityAt: Date.now() - 10_000,
			pinnedWindowId: 1,
			...overrides,
		};
	}

	function renderContent(status: IMcpStatusData | undefined, handlers: Partial<{ onAction: () => void; onCopy: (text: string) => Promise<void> }> = {}) {
		const onAction = handlers.onAction ?? vi.fn();
		const onCopy = handlers.onCopy ?? vi.fn().mockResolvedValue(undefined);
		rtl.render(<McpStatusContent error={undefined} status={status} onAction={onAction} onCopy={onCopy} />);
		return { onAction, onCopy };
	}

	describe('setup checklist', () => {
		it('shows unchecked rows with inline actions in a fresh state', () => {
			const onAction = vi.fn();
			renderContent(makeStatus({
				enabled: false,
				running: false,
				workspaceConfig: 'not-configured',
			}), { onAction });

			expect(screen.getByText('Server disabled')).toBeInTheDocument();
			expect(screen.getByText('.mcp.json not configured')).toBeInTheDocument();
			// One Enable action for the server, one Add for the unchecked config row.
			expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
		});

		it('fires enable when the server row action is pressed', async () => {
			const user = userEvent.setup();
			const onAction = vi.fn();
			renderContent(makeStatus({ enabled: false, running: false }), { onAction });

			await user.click(screen.getByRole('button', { name: 'Enable' }));
			expect(onAction).toHaveBeenCalledWith({ id: 'enable' });
		});

		it('fires addConfig when the .mcp.json row action is pressed', async () => {
			const user = userEvent.setup();
			const onAction = vi.fn();
			renderContent(makeStatus({ workspaceConfig: 'not-configured' }), { onAction });

			await user.click(screen.getByRole('button', { name: 'Add' }));
			expect(onAction).toHaveBeenCalledWith({ id: 'addConfig' });
		});

		it('shows the restart hint while the server is enabled but not yet running', () => {
			renderContent(makeStatus({ enabled: true, running: false }));
			expect(screen.getByText('Server enabled - restart Positron to start it')).toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Enable' })).not.toBeInTheDocument();
		});

		it('collapses to a single Setup complete line when everything is checked', () => {
			renderContent(makeStatus());
			expect(screen.getByText('Setup complete')).toBeInTheDocument();
			expect(screen.queryByText('Setup')).not.toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
		});
	});

	describe('connections', () => {
		it('shows an empty message when the server runs with no sessions', () => {
			renderContent(makeStatus({ sessions: [] }));
			expect(screen.getByText('No agents connected yet.')).toBeInTheDocument();
		});

		it('lists each session with its client identity', () => {
			renderContent(makeStatus({
				sessions: [
					makeSession({ sessionId: 'a', clientName: 'claude-code', clientVersion: '1.2.3' }),
					makeSession({ sessionId: 'b', clientName: 'codex-mcp-client', clientVersion: undefined }),
				],
			}));
			expect(screen.getByText('claude-code 1.2.3')).toBeInTheDocument();
			expect(screen.getByText('codex-mcp-client')).toBeInTheDocument();
		});

		it('labels a session that has not identified itself', () => {
			renderContent(makeStatus({ sessions: [makeSession({ clientName: undefined, clientVersion: undefined })] }));
			expect(screen.getByText('unknown client')).toBeInTheDocument();
		});

		it('shows the window column only when sessions span more than one window', () => {
			renderContent(makeStatus({
				sessions: [
					makeSession({ sessionId: 'a', pinnedWindowId: 1 }),
					makeSession({ sessionId: 'b', pinnedWindowId: 2 }),
				],
			}));
			expect(screen.getByRole('columnheader', { name: 'Window' })).toBeInTheDocument();
		});

		it('omits the window column when all sessions share a window', () => {
			renderContent(makeStatus({
				sessions: [
					makeSession({ sessionId: 'a', pinnedWindowId: 1 }),
					makeSession({ sessionId: 'b', pinnedWindowId: 1 }),
				],
			}));
			expect(screen.queryByRole('columnheader', { name: 'Window' })).not.toBeInTheDocument();
		});

		it('hides the connections section while the server is not running', () => {
			renderContent(makeStatus({ running: false }));
			expect(screen.queryByText('Connections')).not.toBeInTheDocument();
		});
	});

	describe('recent activity', () => {
		it('renders nothing when there is no activity yet', () => {
			renderContent(makeStatus({ recentActivity: [] }));
			expect(screen.queryByText('Recent activity')).not.toBeInTheDocument();
		});

		it('lists completed tool calls with client, duration, and outcome', () => {
			renderContent(makeStatus({
				recentActivity: [
					makeToolCallEvent({ callId: 'a', toolName: 'execute-code', durationMs: 840 }),
					makeToolCallEvent({ callId: 'b', toolName: 'get-plot', clientName: 'codex-mcp-client', clientVersion: undefined, outcome: 'error', durationMs: 12 }),
				],
			}));
			expect(screen.getByText('Recent activity')).toBeInTheDocument();
			expect(screen.getByText('execute-code')).toBeInTheDocument();
			expect(screen.getByText('get-plot')).toBeInTheDocument();
			expect(screen.getByText('codex-mcp-client')).toBeInTheDocument();
			expect(screen.getByText(/840ms/)).toBeInTheDocument();
		});

		it('shows only the last 10 calls, newest first, and skips lifecycle events', () => {
			const recentActivity = [
				{ type: 'session-created' as const, timestamp: Date.now(), sessionId: 'session-1' },
				...Array.from({ length: 12 }, (_, i) => makeToolCallEvent({ callId: `call-${i}`, toolName: `tool-${i}` })),
			];
			renderContent(makeStatus({ recentActivity }));
			// Oldest two of the twelve calls fall outside the 10-row window.
			expect(screen.queryByText('tool-0')).not.toBeInTheDocument();
			expect(screen.queryByText('tool-1')).not.toBeInTheDocument();
			// Newest call renders first.
			const tools = screen.getAllByText(/^tool-\d+$/).map(el => el.textContent);
			expect(tools).toEqual(['tool-11', 'tool-10', 'tool-9', 'tool-8', 'tool-7', 'tool-6', 'tool-5', 'tool-4', 'tool-3', 'tool-2']);
		});
	});

	describe('allow-all consent banner', () => {
		it('is hidden while allow-all is not in effect', () => {
			renderContent(makeStatus({ allowAllConsent: false }));
			expect(screen.queryByText(/code execution is allowed/)).not.toBeInTheDocument();
		});

		it('shows the banner and fires resetConsent', async () => {
			const user = userEvent.setup();
			const onAction = vi.fn();
			renderContent(makeStatus({ allowAllConsent: true }), { onAction });

			expect(screen.getByText('All agent code execution is allowed for this session.')).toBeInTheDocument();
			await user.click(screen.getByRole('button', { name: 'Reset' }));
			expect(onAction).toHaveBeenCalledWith({ id: 'resetConsent' });
		});
	});

	describe('connect card', () => {
		it('shows the Claude Code one-liner by default and copies it', async () => {
			const user = userEvent.setup();
			const onCopy = vi.fn().mockResolvedValue(undefined);
			renderContent(makeStatus(), { onCopy });

			expect(screen.getByText('claude mcp add --transport http positron http://localhost:43123')).toBeInTheDocument();
			await user.click(screen.getByRole('button', { name: 'Copy' }));
			expect(onCopy).toHaveBeenCalledWith('claude mcp add --transport http positron http://localhost:43123');
			expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
		});

		it('switches the snippet when another client is picked', async () => {
			const user = userEvent.setup();
			renderContent(makeStatus());

			await user.click(screen.getByRole('button', { name: 'Codex CLI' }));
			expect(screen.getByText(/mcp_servers\.positron/)).toBeInTheDocument();
			expect(screen.getByText('Add to ~/.codex/config.toml:')).toBeInTheDocument();
		});
	});
});

describe('connectSnippet', () => {
	it('renders each client configuration against the server url', () => {
		expect(connectSnippet('claude-code', 43123)).toMatchInlineSnapshot(
			`"claude mcp add --transport http positron http://localhost:43123"`);
		expect(connectSnippet('codex', 43123)).toMatchInlineSnapshot(`
			"[mcp_servers.positron]
			url = "http://localhost:43123""
		`);
		expect(connectSnippet('gemini-cli', 43123)).toMatchInlineSnapshot(
			`"gemini mcp add --transport http positron http://localhost:43123"`);
		expect(connectSnippet('cursor', 43123)).toMatchInlineSnapshot(`
			"{
			  "mcpServers": {
			    "positron": { "url": "http://localhost:43123" }
			  }
			}"
		`);
		expect(connectSnippet('vscode', 43123)).toMatchInlineSnapshot(`
			"{
			  "servers": {
			    "positron": { "type": "http", "url": "http://localhost:43123" }
			  }
			}"
		`);
	});

	it('respects a non-default port', () => {
		expect(connectSnippet('claude-code', 50000)).toContain('http://localhost:50000');
	});
});
