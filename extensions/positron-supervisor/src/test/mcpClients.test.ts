/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { McpClient } from '../kcclient/api';
import { agentLabel, agentQuickPickItem, describeClient } from '../mcpClients';
import { statusBarText } from '../McpClientsStatusBar';

/** A connected client, as the supervisor reports one. */
function client(id: number, fields: Partial<McpClient> = {}): McpClient {
	return { id, connected_at: '2026-09-22T10:00:00Z', ...fields };
}

suite('agentLabel', () => {
	test('shows the harnesses Positron knows under their own names', () => {
		assert.deepStrictEqual(
			[
				client(1, { name: 'claude-code' }),
				client(2, { name: 'codex-mcp-client' }),
				client(3, { name: 'gemini-cli-mcp-client' }),
				client(4, { name: 'my-custom-agent' }),
				client(5),
			].map(agentLabel),
			['Claude Code', 'Codex', 'Gemini CLI', 'my-custom-agent', 'Unknown agent']);
	});
});

suite('describeClient', () => {
	test('names the agent and says where it is running', () => {
		assert.deepStrictEqual(
			[
				describeClient(client(1, {
					name: 'claude-code', version: '2.1.0', pid: 4242, working_directory: '/home/me/project',
				})),
				describeClient(client(2, { name: 'codex-mcp-client' })),
			],
			['Claude Code 2.1.0 (pid 4242, /home/me/project)', 'Codex']);
	});
});

suite('statusBarText', () => {
	test('names a lone agent, counts several of a kind, and counts a mix', () => {
		assert.deepStrictEqual(
			[
				statusBarText([]),
				statusBarText([client(1, { name: 'claude-code' })]),
				statusBarText([client(1, { name: 'claude-code' }), client(2, { name: 'claude-code' })]),
				statusBarText([client(1, { name: 'claude-code' }), client(2, { name: 'codex-mcp-client' })]),
			],
			[
				undefined,
				'$(robot) Claude Code',
				'$(robot) Claude Code (2)',
				'$(robot) 2 Agents',
			]);
	});
});

suite('agentQuickPickItem', () => {
	test('describes an agent, naming its workspace only when asked', () => {
		const inKernel = client(1, {
			name: 'claude-code', version: '2.1.0', working_directory: '/home/me/project', session_id: 'python-1',
		});
		const time = new Date(inKernel.connected_at).toLocaleTimeString();

		assert.deepStrictEqual(
			[agentQuickPickItem(inKernel), agentQuickPickItem(client(2), 'other-project')],
			[
				{
					label: '$(robot) Claude Code',
					description: '2.1.0',
					detail: `/home/me/project • inside session python-1 • connected at ${time}`,
				},
				{
					label: '$(robot) Unknown agent',
					description: 'other-project',
					detail: `connected at ${time}`,
				},
			]);
	});
});

