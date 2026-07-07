/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { computeMcpStatusEntry, IMcpStatusBarState } from '../../browser/positronMcpStatusBar.js';

/** An enabled, fully configured, idle state; tests override what they exercise. */
function makeState(overrides: Partial<IMcpStatusBarState> = {}): IMcpStatusBarState {
	return {
		enabled: true,
		configState: 'configured',
		inFlightCount: 0,
		latestInFlight: undefined,
		allowAll: false,
		...overrides,
	};
}

describe('computeMcpStatusEntry', () => {
	it('hides the entry while the server is disabled', () => {
		expect(computeMcpStatusEntry(makeState({ enabled: false }))).toBeUndefined();
		expect(computeMcpStatusEntry(makeState({ enabled: false, inFlightCount: 1, allowAll: true }))).toBeUndefined();
	});

	it('shows the idle plug when enabled with nothing going on', () => {
		expect(computeMcpStatusEntry(makeState())).toMatchObject({
			text: '$(plug) MCP',
			kind: 'standard',
			tooltip: 'MCP server enabled. Click for details.',
		});
	});

	it('spins with a client-and-tool tooltip for a single in-flight call', () => {
		expect(computeMcpStatusEntry(makeState({
			inFlightCount: 1,
			latestInFlight: { toolName: 'execute-code', clientName: 'claude-code' },
		}))).toMatchObject({
			text: '$(loading~spin) MCP',
			kind: 'standard',
			tooltip: 'Claude Code: execute-code running...',
		});
	});

	it('falls back to the anonymous agent label when the caller is unidentified', () => {
		expect(computeMcpStatusEntry(makeState({
			inFlightCount: 1,
			latestInFlight: { toolName: 'get-plot' },
		}))).toMatchObject({ tooltip: 'External Agent: get-plot running...' });
	});

	it('summarizes concurrent calls with a count and the latest tool', () => {
		expect(computeMcpStatusEntry(makeState({
			inFlightCount: 3,
			latestInFlight: { toolName: 'get-variables', clientName: 'codex-mcp-client' },
		}))).toMatchObject({
			text: '$(loading~spin) MCP',
			tooltip: '3 MCP tool calls running (latest: get-variables). Click for details.',
		});
	});

	it('shows the allow-all attention state when idle', () => {
		expect(computeMcpStatusEntry(makeState({ allowAll: true }))).toMatchObject({
			text: '$(warning) MCP',
			kind: 'warning',
			tooltip: 'All agent code execution is allowed for this session. Click to review or reset.',
		});
	});

	it('keeps the warning kind while spinning under allow-all', () => {
		expect(computeMcpStatusEntry(makeState({
			allowAll: true,
			inFlightCount: 1,
			latestInFlight: { toolName: 'execute-code', clientName: 'claude-code' },
		}))).toMatchObject({ text: '$(loading~spin) MCP', kind: 'warning' });
	});

	it('allow-all attention takes the text over the missing-config warning', () => {
		expect(computeMcpStatusEntry(makeState({ allowAll: true, configState: 'not-configured' }))).toMatchObject({
			text: '$(warning) MCP',
			kind: 'warning',
			tooltip: 'All agent code execution is allowed for this session. Click to review or reset.',
		});
	});

	it('warns about a missing .mcp.json when that is the only issue', () => {
		expect(computeMcpStatusEntry(makeState({ configState: 'not-configured' }))).toMatchObject({
			text: '$(warning) MCP',
			kind: 'warning',
			tooltip: 'MCP server enabled, but this workspace has no .mcp.json. Click for details.',
		});
	});

	it('warns about a stale .mcp.json that lacks the current token', () => {
		expect(computeMcpStatusEntry(makeState({ configState: 'stale' }))).toMatchObject({
			text: '$(warning) MCP',
			kind: 'warning',
			tooltip: 'MCP server enabled, but this workspace\'s .mcp.json is missing the current access token. Click for details.',
		});
	});
});
