/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { agentCliAdds, agentCliCommand, agentCliRemoves, cliEntryOutdated } from '../McpAgentConfig';
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

suite('agentCliRemoves and agentCliAdds', () => {
	test('write under both drive letter cases on Windows', () => {
		// Claude Code keys entries by its working directory's exact text, which
		// is C:\ from a terminal but c:\ from cmd's `cd c:\` or a folder's fsPath.
		const install = cliInstall('claude-code');
		const directories = (runs: { directory: string }[]) => runs.map(run => run.directory);
		assert.deepStrictEqual(
			{
				removes: directories(agentCliRemoves(install, {}, 'c:\\proj', 'win32')),
				adds: directories(agentCliAdds(install, LAUNCH, 'c:\\proj', 'win32')),
			},
			{
				removes: ['c:\\proj', 'C:\\proj'],
				adds: ['c:\\proj', 'C:\\proj'],
			});
	});
});

suite('cliEntryOutdated', () => {
	test('rewrites an entry written before directories were recorded only on Windows', () => {
		// Elsewhere the entry is already where it belongs, so it is not
		// written again: a user who removed it does not get it back.
		assert.deepStrictEqual(
			{
				windows: cliEntryOutdated({}, 'c:\\proj', 'win32'),
				macos: cliEntryOutdated({}, '/Users/me/proj', 'darwin'),
			},
			{ windows: true, macos: false });
	});

	test('rewrites it only once', () => {
		assert.strictEqual(cliEntryOutdated({ directory: 'c:\\proj' }, 'c:\\proj', 'win32'), false);
	});
});
