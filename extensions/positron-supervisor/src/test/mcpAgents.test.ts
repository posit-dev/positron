/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { MCP_AGENTS, McpAgent, findMcpAgent, mergeAgentConfig, mergeTomlConfig } from '../McpAgents';
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

/** The row under test, which the table is required to have. */
function agent(id: string): McpAgent {
	const found = findMcpAgent(id);
	assert.ok(found, `no agent row for ${id}`);
	return found;
}

suite('mergeAgentConfig', () => {
	test('writes Claude Code its own dialect, naming no port and no token', () => {
		// The endpoint and token are left as variables Claude Code expands, so
		// the file holds no secret and stays correct across a restart that
		// moves the port: it is safe to commit.
		assert.deepStrictEqual(
			JSON.parse(mergeAgentConfig(agent('claude-code'), undefined, CONNECTION)),
			{
				mcpServers: {
					positron: {
						type: 'http',
						url: '${POSITRON_MCP_URL}',
						headers: { Authorization: 'Bearer ${POSITRON_MCP_TOKEN}' },
					},
				},
			});
	});

	test('writes Gemini its own dialect, where naming httpUrl is what picks the transport', () => {
		assert.deepStrictEqual(
			JSON.parse(mergeAgentConfig(agent('gemini'), undefined, CONNECTION)),
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
		// Codex does not expand variables, so the endpoint is written out; the
		// workspace ID and port in it are the ones Positron asks the supervisor
		// to reuse, so it survives restarts. The token is not written at all:
		// Codex runs the command and reads the header from its output.
		assert.strictEqual(
			mergeAgentConfig(agent('codex'), undefined, CONNECTION),
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

		const merged = JSON.parse(mergeAgentConfig(agent('claude-code'), existing, CONNECTION));

		assert.deepStrictEqual(
			{ servers: Object.keys(merged.mcpServers).sort(), other: merged.someOtherSetting },
			{ servers: ['other', 'positron'], other: true });
	});

	test('rejects a file it cannot parse rather than overwriting it', () => {
		assert.throws(() => mergeAgentConfig(agent('claude-code'), '{ this is not JSON', CONNECTION));
	});

	test('gives every row a unique id and a way to detect it', () => {
		assert.deepStrictEqual(
			MCP_AGENTS.map(row => [row.id, !!(row.detect.executable || row.detect.extensionId)]),
			[['claude-code', true], ['codex', true], ['gemini', true]]);
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
