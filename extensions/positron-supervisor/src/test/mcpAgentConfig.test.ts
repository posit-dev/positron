/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { agentCliCommand } from '../McpAgentConfig';
import { McpCliInstall, findMcpAgent, mcpLaunch } from '../McpAgents';

/** The command line that starts the bridge. */
const LAUNCH = mcpLaunch('/opt/positron/kcserver', '/storage/mcp');

/** The install of the row that is configured by running its CLI. */
function cliInstall(id: string): McpCliInstall {
	const agent = findMcpAgent(id);
	assert.ok(agent, `no agent row for ${id}`);
	assert.strictEqual(agent.install.kind, 'cli', `${id} is not configured by CLI`);
	return agent.install;
}

suite('agentCliCommand', () => {
	test('runs the CLI directly, adding the bridge, which names no port and no token', () => {
		assert.deepStrictEqual(
			agentCliCommand('/usr/local/bin/claude', cliInstall('claude-code').add(LAUNCH)),
			{
				command: '/usr/local/bin/claude',
				args: [
					'mcp', 'add',
					'--scope', 'local',
					'positron',
					// Everything after this is the server's command line, not
					// options for the CLI.
					'--',
					'/opt/positron/kcserver',
					'mcp-stdio', '--connections', '/storage/mcp',
				],
			});
	});

	test('can take back out what it put in, in the same scope', () => {
		// Adding is only idempotent because the entry is removed first: the CLI
		// refuses to add a server that is already there.
		assert.deepStrictEqual(
			agentCliCommand('/usr/local/bin/claude', cliInstall('claude-code').remove).args,
			['mcp', 'remove', 'positron', '--scope', 'local']);
	});

	test('runs a Windows batch launcher under cmd, which cannot be spawned directly', () => {
		const { command, args } = agentCliCommand('C:\\bin\\claude.CMD', cliInstall('claude-code').add(LAUNCH));

		assert.deepStrictEqual(
			{ command, first: args.slice(0, 2) },
			{ command: 'cmd.exe', first: ['/c', 'C:\\bin\\claude.CMD'] });
	});
});
