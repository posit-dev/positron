/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { claudeMcpAddCommand, mergeClaudeCodeConfig, mergeCodexConfig } from '../McpAgentConfig';

suite('mergeClaudeCodeConfig', () => {
	test('creates a configuration that names no port and no token', () => {
		const merged = JSON.parse(mergeClaudeCodeConfig(undefined));

		assert.deepStrictEqual(merged, {
			mcpServers: {
				positron: {
					type: 'http',
					url: '${POSITRON_MCP_URL}',
					headers: { Authorization: 'Bearer ${POSITRON_MCP_TOKEN}' },
				},
			},
		});
	});

	test('preserves the other servers and settings already in the file', () => {
		const existing = JSON.stringify({
			mcpServers: { other: { command: 'other-server' } },
			someOtherSetting: true,
		});

		const merged = JSON.parse(mergeClaudeCodeConfig(existing));

		assert.deepStrictEqual(
			{ servers: Object.keys(merged.mcpServers).sort(), other: merged.someOtherSetting },
			{ servers: ['other', 'positron'], other: true });
	});

	test('rejects a file it cannot parse rather than overwriting it', () => {
		assert.throws(() => mergeClaudeCodeConfig('{ this is not JSON'));
	});
});

suite('mergeCodexConfig', () => {
	const url = 'http://127.0.0.1:39000/mcp';

	test('creates a configuration naming the port but not the token', () => {
		assert.strictEqual(
			mergeCodexConfig(undefined, url),
			'[mcp_servers.positron]\n' +
			'url = "http://127.0.0.1:39000/mcp"\n' +
			'bearer_token_env_var = "POSITRON_MCP_TOKEN"\n');
	});

	test('appends to a file that configures other things', () => {
		const existing = 'model = "o3"\n\n[mcp_servers.other]\nurl = "http://localhost:1/mcp"\n';

		assert.strictEqual(
			mergeCodexConfig(existing, url),
			'model = "o3"\n' +
			'\n' +
			'[mcp_servers.other]\n' +
			'url = "http://localhost:1/mcp"\n' +
			'\n' +
			'[mcp_servers.positron]\n' +
			'url = "http://127.0.0.1:39000/mcp"\n' +
			'bearer_token_env_var = "POSITRON_MCP_TOKEN"\n');
	});

	test('rewrites our own table in place when the port changes', () => {
		const existing =
			'[mcp_servers.positron]\n' +
			'url = "http://127.0.0.1:12345/mcp"\n' +
			'bearer_token_env_var = "POSITRON_MCP_TOKEN"\n' +
			'\n' +
			'[mcp_servers.other]\n' +
			'url = "http://localhost:1/mcp"\n';

		assert.strictEqual(
			mergeCodexConfig(existing, url),
			'[mcp_servers.positron]\n' +
			'url = "http://127.0.0.1:39000/mcp"\n' +
			'bearer_token_env_var = "POSITRON_MCP_TOKEN"\n' +
			'\n' +
			'[mcp_servers.other]\n' +
			'url = "http://localhost:1/mcp"\n');
	});
});

suite('claudeMcpAddCommand', () => {
	test('runs the CLI directly, naming no port and no token', () => {
		assert.deepStrictEqual(
			claudeMcpAddCommand('/usr/local/bin/claude'),
			{
				command: '/usr/local/bin/claude',
				args: [
					'mcp', 'add',
					'--transport', 'http',
					'--scope', 'local',
					'positron',
					'${POSITRON_MCP_URL}',
					'--header', 'Authorization: Bearer ${POSITRON_MCP_TOKEN}',
				],
			});
	});

	test('runs a Windows batch launcher under cmd, which cannot be spawned directly', () => {
		const { command, args } = claudeMcpAddCommand('C:\\bin\\claude.CMD');

		assert.deepStrictEqual(
			{ command, first: args.slice(0, 2) },
			{ command: 'cmd.exe', first: ['/c', 'C:\\bin\\claude.CMD'] });
	});
});
