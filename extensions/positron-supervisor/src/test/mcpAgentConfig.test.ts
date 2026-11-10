/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { agentCliCommand, agentCliDirectories } from '../McpAgentConfig';
import { McpCliInstall, McpLaunch, findMcpAgent } from '../McpAgents';

/** The command line that starts the bridge. */
const LAUNCH: McpLaunch = { command: '/bin/sh', args: ['/storage/mcp/bin/positron-mcp'] };

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
					'/bin/sh',
					'/storage/mcp/bin/positron-mcp',
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

suite('agentCliDirectories', () => {
	test('writes from the uppercase drive a terminal starts in, and clears the lowercase one', () => {
		// Claude Code keys its entry by the working directory's exact text, and
		// a folder's fsPath has a lowercase drive letter (#17217).
		assert.deepStrictEqual(
			agentCliDirectories('c:\\Users\\me\\project', 'win32'),
			['C:\\Users\\me\\project', 'c:\\Users\\me\\project']);
	});

	test('leaves a path with no drive letter alone', () => {
		assert.deepStrictEqual(
			{
				unc: agentCliDirectories('\\\\server\\share\\project', 'win32'),
				posix: agentCliDirectories('/home/me/project', 'linux'),
				colonOffWindows: agentCliDirectories('c:/odd/name', 'darwin'),
			},
			{
				unc: ['\\\\server\\share\\project'],
				posix: ['/home/me/project'],
				colonOffWindows: ['c:/odd/name'],
			});
	});
});
