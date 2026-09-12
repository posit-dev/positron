/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CLAUDE_MCP_ADD_ARGS, agentCliCommand, codexMcpAddArgs, insertHeadersHelper, mergeClaudeCodeConfig } from '../McpAgentConfig';

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

suite('codexMcpAddArgs', () => {
	test('names the endpoint but not the token, for the configuration Codex reads', () => {
		// Codex has no per-project configuration and does not expand variables
		// in `url`, so the endpoint goes to its CLI, which owns the one file it
		// does read. A file in the workspace would be ignored. The token is not
		// here because the CLI can only name an environment variable for it, and
		// Codex fails the server outright when that variable is missing -- which
		// it is for the Codex extension, whatever the terminal has.
		assert.deepStrictEqual(
			codexMcpAddArgs('http://127.0.0.1:39000/mcp/w/my-project-2458p3'),
			[
				'mcp', 'add',
				'positron',
				'--url', 'http://127.0.0.1:39000/mcp/w/my-project-2458p3',
			]);
	});
});

suite('insertHeadersHelper', () => {
	test('adds the helper to the entry the CLI wrote, leaving the rest alone', () => {
		// The shape the CLI leaves behind: it rewrites its own table and moves
		// nothing else, including the settings a user put around it.
		const config = [
			'model = "gpt-5"',
			'',
			'[mcp_servers.other]',
			'command = "other-server"',
			'',
			'[mcp_servers.positron]',
			'url = "http://127.0.0.1:39000/mcp/w/my-project-2458p3"',
			'',
		].join('\n');

		assert.strictEqual(
			insertHeadersHelper(config, `cat '/storage/mcp/my-project-2458p3.json'`),
			[
				'model = "gpt-5"',
				'',
				'[mcp_servers.other]',
				'command = "other-server"',
				'',
				'[mcp_servers.positron]',
				`http_headers_helper = "cat '/storage/mcp/my-project-2458p3.json'"`,
				'url = "http://127.0.0.1:39000/mcp/w/my-project-2458p3"',
				'',
			].join('\n'));
	});

	test('quotes a Windows path, whose separators TOML would otherwise escape', () => {
		const config = '[mcp_servers.positron]\nurl = "http://127.0.0.1:39000/mcp/w/w-1"\n';

		assert.ok(insertHeadersHelper(config, 'type "C:\\storage\\mcp\\w-1.json"')
			.includes('http_headers_helper = "type \\"C:\\\\storage\\\\mcp\\\\w-1.json\\""'));
	});

	test('refuses a file the CLI left no entry in rather than guessing', () => {
		assert.throws(() => insertHeadersHelper('model = "gpt-5"\n', 'cat /storage/w-1.json'));
	});
});

suite('agentCliCommand', () => {
	test('runs the CLI directly, naming no port and no token', () => {
		assert.deepStrictEqual(
			agentCliCommand('/usr/local/bin/claude', CLAUDE_MCP_ADD_ARGS),
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
		const { command, args } = agentCliCommand('C:\\bin\\claude.CMD', CLAUDE_MCP_ADD_ARGS);

		assert.deepStrictEqual(
			{ command, first: args.slice(0, 2) },
			{ command: 'cmd.exe', first: ['/c', 'C:\\bin\\claude.CMD'] });
	});
});
