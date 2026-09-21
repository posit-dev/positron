/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	MCP_AGENTS,
	McpFileInstall,
	findMcpAgent,
	mergeAgentConfig,
	mergeTomlConfig,
	pinsEndpoint,
	unmergeAgentConfig,
	unmergeTomlConfig,
} from '../McpAgents';
import { McpConnection } from '../mcpConnection';

/** A registration with the shape the merges read: a URL and a headers file. */
const CONNECTION: McpConnection = {
	workspaceId: 'my-project-2458p3',
	displayName: 'my-project',
	port: 39000,
	token: 'secret',
	url: 'http://127.0.0.1:39000/mcp/w/my-project-2458p3',
	headersPath: '/storage/mcp/headers/my-project-2458p3.json',
};

/** The file install of the row under test, which the table is required to have. */
function fileInstall(id: string): McpFileInstall {
	const agent = findMcpAgent(id);
	assert.ok(agent, `no agent row for ${id}`);
	assert.strictEqual(agent.install.kind, 'file', `${id} is not configured by file`);
	return agent.install;
}

suite('mergeAgentConfig', () => {
	test('writes Gemini its own dialect, where naming httpUrl is what picks the transport', () => {
		// The endpoint and token are left as variables Gemini expands, so the
		// file holds no secret and stays correct across a restart that moves
		// the port.
		assert.deepStrictEqual(
			JSON.parse(mergeAgentConfig(fileInstall('gemini'), undefined, CONNECTION)),
			{
				mcpServers: {
					positron: {
						httpUrl: '${POSITRON_MCP_URL}',
						headers: { Authorization: 'Bearer ${POSITRON_MCP_TOKEN}' },
					},
				},
			});
	});

	test('writes Codex the endpoint and a headers command, since it expands neither', () => {
		// Codex does not expand variables, so the endpoint is written out. The
		// token is not written at all: Codex runs the command and reads the
		// header from its output, which is what keeps it working when the
		// token behind the endpoint is reissued.
		assert.strictEqual(
			mergeAgentConfig(fileInstall('codex'), undefined, CONNECTION),
			[
				'[mcp_servers.positron]',
				'url = "http://127.0.0.1:39000/mcp/w/my-project-2458p3"',
				`http_headers_helper = "cat '/storage/mcp/headers/my-project-2458p3.json'"`,
				'',
			].join('\n'));
	});

	test('preserves the other servers and settings already in a JSON file', () => {
		const existing = JSON.stringify({
			mcpServers: { other: { command: 'other-server' } },
			someOtherSetting: true,
		});

		const merged = JSON.parse(mergeAgentConfig(fileInstall('gemini'), existing, CONNECTION));

		assert.deepStrictEqual(
			{ servers: Object.keys(merged.mcpServers).sort(), other: merged.someOtherSetting },
			{ servers: ['other', 'positron'], other: true });
	});

	test('rejects a file it cannot parse rather than overwriting it', () => {
		assert.throws(() => mergeAgentConfig(fileInstall('gemini'), '{ this is not JSON', CONNECTION));
	});

	test('gives every row a unique id, a way to detect it, and a way to install it', () => {
		assert.deepStrictEqual(
			MCP_AGENTS.map(row => [
				row.id,
				!!(row.detect.executable || row.detect.extensionId),
				row.install.kind,
				// Only an entry naming the endpoint itself can be left pointing
				// at a port that has moved, and so needs rewriting.
				pinsEndpoint(row),
			]),
			[
				['claude-code', true, 'cli', false],
				['codex', true, 'file', true],
				['gemini', true, 'file', false],
			]);
	});
});

suite('unmergeAgentConfig', () => {
	test('takes our server out of a JSON file and leaves the rest', () => {
		const existing = mergeAgentConfig(
			fileInstall('gemini'),
			JSON.stringify({ mcpServers: { other: { command: 'other-server' } }, ui: 'dark' }),
			CONNECTION);

		assert.deepStrictEqual(
			JSON.parse(unmergeAgentConfig(fileInstall('gemini'), existing)),
			{ mcpServers: { other: { command: 'other-server' } }, ui: 'dark' });
	});

	test('takes our table out of a TOML file, round-tripping what we wrote', () => {
		const original = 'model = "gpt-5"\n';
		const merged = mergeAgentConfig(fileInstall('codex'), original, CONNECTION);

		assert.strictEqual(unmergeAgentConfig(fileInstall('codex'), merged), original);
	});
});

suite('mergeTomlConfig', () => {
	const ENTRY = { url: 'http://127.0.0.1:39000/mcp/w/w-1', http_headers_helper: 'cat /h.json' };

	test('appends to a file that has no entry of ours, leaving the rest alone', () => {
		assert.strictEqual(
			mergeTomlConfig('model = "gpt-5"\n', 'mcp_servers', ENTRY),
			[
				'model = "gpt-5"',
				'',
				'[mcp_servers.positron]',
				'url = "http://127.0.0.1:39000/mcp/w/w-1"',
				'http_headers_helper = "cat /h.json"',
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
				'url = "http://127.0.0.1:39000/mcp/w/w-1"',
				'http_headers_helper = "cat /h.json"',
				'',
				'[mcp_servers.other]',
				'command = "other-server"',
				'',
			].join('\n'));
	});

	test('quotes a Windows path, whose separators TOML would otherwise escape', () => {
		assert.ok(
			mergeTomlConfig(undefined, 'mcp_servers', { http_headers_helper: 'type "C:\\h.json"' })
				.includes('http_headers_helper = "type \\"C:\\\\h.json\\""'));
	});

	test('writes nested headers as an inline table rather than as JSON', () => {
		assert.ok(
			mergeTomlConfig(undefined, 'mcp_servers', { headers: { Authorization: 'Bearer x' } })
				.includes('headers = { Authorization = "Bearer x" }'));
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
