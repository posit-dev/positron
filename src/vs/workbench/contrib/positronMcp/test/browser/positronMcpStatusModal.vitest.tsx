/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IMcpSessionInfo } from '../../../../../platform/positronMcp/common/positronMcp.js';
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
			guidance: [
				{ file: 'AGENTS.md', present: true },
				{ file: 'CLAUDE.md', present: true },
			],
			sessions: [],
			allowAllConsent: false,
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
				guidance: [
					{ file: 'AGENTS.md', present: false },
					{ file: 'CLAUDE.md', present: false },
				],
			}), { onAction });

			expect(screen.getByText('Server disabled')).toBeInTheDocument();
			expect(screen.getByText('.mcp.json not configured')).toBeInTheDocument();
			expect(screen.getByText('AGENTS.md has no agent guidance')).toBeInTheDocument();
			expect(screen.getByText('CLAUDE.md has no agent guidance')).toBeInTheDocument();
			// One Enable action for the server, one Add per unchecked row.
			expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
			expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(3);
		});

		it('fires enable when the server row action is pressed', async () => {
			const user = userEvent.setup();
			const onAction = vi.fn();
			renderContent(makeStatus({ enabled: false, running: false }), { onAction });

			await user.click(screen.getByRole('button', { name: 'Enable' }));
			expect(onAction).toHaveBeenCalledWith({ id: 'enable' });
		});

		it('renders done guidance as a check and offers Add only for the missing file', async () => {
			const user = userEvent.setup();
			const onAction = vi.fn();
			renderContent(makeStatus({
				guidance: [
					{ file: 'AGENTS.md', present: false },
					{ file: 'CLAUDE.md', present: true },
				],
			}), { onAction });

			expect(screen.getByText('CLAUDE.md has agent guidance')).toBeInTheDocument();
			expect(screen.getByText('AGENTS.md has no agent guidance')).toBeInTheDocument();
			await user.click(screen.getByRole('button', { name: 'Add' }));
			expect(onAction).toHaveBeenCalledWith({ id: 'addGuidance', file: 'AGENTS.md' });
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
