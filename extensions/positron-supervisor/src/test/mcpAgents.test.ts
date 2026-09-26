/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	MCP_AGENTS,
	McpFileInstall,
	findMcpAgent,
	mcpLaunch,
	mergeAgentConfig,
	mergeTomlConfig,
	unmergeAgentConfig,
	unmergeTomlConfig,
} from '../McpAgents';

/** The command line that starts the bridge, as a registration would build it. */
const LAUNCH = mcpLaunch('/opt/positron/kcserver', '/storage/mcp');

/** The file install of the row under test, which the table is required to have. */
function fileInstall(id: string): McpFileInstall {
	const agent = findMcpAgent(id);
	assert.ok(agent, `no agent row for ${id}`);
	assert.strictEqual(agent.install.kind, 'file', `${id} is not configured by file`);
	return agent.install;
}

suite('mergeAgentConfig', () => {
	test('writes Gemini a command line, which names no port and no token', () => {
		assert.deepStrictEqual(
			JSON.parse(mergeAgentConfig(fileInstall('gemini'), undefined, LAUNCH)),
			{
				mcpServers: {
					positron: {
						command: '/opt/positron/kcserver',
						args: ['mcp-stdio', '--connections', '/storage/mcp'],
					},
				},
			});
	});

	test('writes Codex a command line, and tells it to pass on the endpoint', () => {
		// Codex gives a server only an allowlist of its environment, so a Codex
		// started from a Positron terminal would otherwise hide the endpoint
		// the bridge reads first.
		assert.strictEqual(
			mergeAgentConfig(fileInstall('codex'), undefined, LAUNCH),
			[
				'[mcp_servers.positron]',
				'command = "/opt/positron/kcserver"',
				'args = ["mcp-stdio", "--connections", "/storage/mcp"]',
				'env_vars = ["POSITRON_MCP_URL", "POSITRON_MCP_TOKEN"]',
				'',
			].join('\n'));
	});

	test('preserves the other servers and settings already in a JSON file', () => {
		const existing = JSON.stringify({
			mcpServers: { other: { command: 'other-server' } },
			someOtherSetting: true,
		});

		const merged = JSON.parse(mergeAgentConfig(fileInstall('gemini'), existing, LAUNCH));

		assert.deepStrictEqual(
			{ servers: Object.keys(merged.mcpServers).sort(), other: merged.someOtherSetting },
			{ servers: ['other', 'positron'], other: true });
	});

	test('rejects a file it cannot parse rather than overwriting it', () => {
		assert.throws(() => mergeAgentConfig(fileInstall('gemini'), '{ this is not JSON', LAUNCH));
	});

	test('gives every row a unique id, a way to detect it, and a way to install it', () => {
		assert.deepStrictEqual(
			MCP_AGENTS.map(row => [
				row.id,
				!!(row.detect.executable || row.detect.extensionId),
				row.install.kind,
			]),
			[
				['claude-code', true, 'cli'],
				['codex', true, 'file'],
				['gemini', true, 'file'],
			]);
	});
});

suite('unmergeAgentConfig', () => {
	test('takes our server out of a JSON file and leaves the rest', () => {
		const existing = mergeAgentConfig(
			fileInstall('gemini'),
			JSON.stringify({ mcpServers: { other: { command: 'other-server' } }, ui: 'dark' }),
			LAUNCH);

		assert.deepStrictEqual(
			JSON.parse(unmergeAgentConfig(fileInstall('gemini'), existing)),
			{ mcpServers: { other: { command: 'other-server' } }, ui: 'dark' });
	});

	test('takes our table out of a TOML file, round-tripping what we wrote', () => {
		const original = 'model = "gpt-5"\n';
		const merged = mergeAgentConfig(fileInstall('codex'), original, LAUNCH);

		assert.strictEqual(unmergeAgentConfig(fileInstall('codex'), merged), original);
	});
});

suite('mergeTomlConfig', () => {
	const ENTRY = { command: '/opt/positron/kcserver', args: ['mcp-stdio'] };

	test('appends to a file that has no entry of ours, leaving the rest alone', () => {
		assert.strictEqual(
			mergeTomlConfig('model = "gpt-5"\n', 'mcp_servers', ENTRY),
			[
				'model = "gpt-5"',
				'',
				'[mcp_servers.positron]',
				'command = "/opt/positron/kcserver"',
				'args = ["mcp-stdio"]',
				'',
			].join('\n'));
	});

	test('replaces our own entry without disturbing the tables around it', () => {
		const config = [
			'model = "gpt-5"',
			'',
			'[mcp_servers.positron]',
			'url = "http://127.0.0.1:1234/mcp/w/stale"',
			'',
			'[mcp_servers.other]',
			'command = "other-server"',
			'',
		].join('\n');

		assert.strictEqual(
			mergeTomlConfig(config, 'mcp_servers', ENTRY),
			[
				'model = "gpt-5"',
				'',
				'[mcp_servers.positron]',
				'command = "/opt/positron/kcserver"',
				'args = ["mcp-stdio"]',
				'',
				'[mcp_servers.other]',
				'command = "other-server"',
				'',
			].join('\n'));
	});

	test('recognizes our entry however its header is spelled, rather than adding a duplicate', () => {
		const config = [
			'[ "mcp_servers" . \'positron\' ]  # mine',
			'args = [',
			'  ["nested"],',
			']',
			'',
			'[[profiles]]',
			'name = "work"',
			'',
		].join('\n');

		assert.strictEqual(
			mergeTomlConfig(config, 'mcp_servers', ENTRY),
			[
				'[mcp_servers.positron]',
				'command = "/opt/positron/kcserver"',
				'args = ["mcp-stdio"]',
				'',
				'[[profiles]]',
				'name = "work"',
				'',
			].join('\n'));
	});

	test('quotes a Windows path, whose separators TOML would otherwise escape', () => {
		assert.ok(
			mergeTomlConfig(undefined, 'mcp_servers', { command: 'C:\\Positron\\kcserver.exe' })
				.includes('command = "C:\\\\Positron\\\\kcserver.exe"'));
	});
});

suite('unmergeTomlConfig', () => {
	test('takes the tables nested under ours with it, leaving no broken server behind', () => {
		// Per-tool settings a user added would otherwise be all that is left of
		// the server, which the harness reports as broken.
		const config = [
			'[mcp_servers.positron]',
			'url = "http://127.0.0.1:1234/mcp/w/stale"',
			'',
			'[mcp_servers.positron.tools.execute_code]',
			'approval_mode = "approve"',
			'',
			'[mcp_servers.other]',
			'command = "other-server"',
			'',
		].join('\n');

		assert.strictEqual(
			unmergeTomlConfig(config, 'mcp_servers'),
			['[mcp_servers.other]', 'command = "other-server"', ''].join('\n'));
	});

	test('leaves a file with no entry of ours exactly as it was', () => {
		const config = 'model = "gpt-5"\n';

		assert.strictEqual(unmergeTomlConfig(config, 'mcp_servers'), config);
	});
});
