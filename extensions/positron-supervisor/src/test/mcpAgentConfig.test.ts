/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { agentCliCommand, agentCliDirectory, staleAgentDirectory } from '../McpAgentConfig';
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

suite('agentCliDirectory', () => {
	test('runs in the uppercase drive a terminal starts in, and leaves other paths alone', () => {
		// Claude Code keys its entry by the working directory's exact text, and
		// a folder's fsPath has a lowercase drive letter (#17217).
		assert.deepStrictEqual(
			{
				lowerDrive: agentCliDirectory('c:\\Users\\me\\project', 'win32'),
				upperDrive: agentCliDirectory('C:\\Users\\me\\project', 'win32'),
				driveRoot: agentCliDirectory('d:\\', 'win32'),
				unc: agentCliDirectory('\\\\server\\share\\project', 'win32'),
				posix: agentCliDirectory('/home/me/project', 'linux'),
				colonOffWindows: agentCliDirectory('c:/odd/name', 'darwin'),
			},
			{
				lowerDrive: 'C:\\Users\\me\\project',
				upperDrive: 'C:\\Users\\me\\project',
				driveRoot: 'D:\\',
				unc: '\\\\server\\share\\project',
				posix: '/home/me/project',
				colonOffWindows: 'c:/odd/name',
			});
	});
});

suite('staleAgentDirectory', () => {
	test('finds the entry a released build left under the lowercase drive, on Windows only', () => {
		// Released builds recorded no directory, and wrote from the fsPath.
		assert.deepStrictEqual(
			{
				windows: staleAgentDirectory({}, 'c:\\proj', 'win32'),
				macos: staleAgentDirectory({}, '/Users/me/proj', 'darwin'),
			},
			{
				windows: 'c:\\proj',
				// Already where it belongs, so it is not written again: a user
				// who removed it does not get it back.
				macos: undefined,
			});
	});

	test('finds nothing to move when the entry is where it belongs, or there is none', () => {
		assert.deepStrictEqual(
			{
				migrated: staleAgentDirectory({ directory: 'C:\\proj' }, 'c:\\proj', 'win32'),
				neverConfigured: staleAgentDirectory(undefined, 'c:\\proj', 'win32'),
			},
			{ migrated: undefined, neverConfigured: undefined });
	});

	test('finds the entry in a folder that is no longer first', () => {
		assert.strictEqual(
			staleAgentDirectory({ directory: '/home/me/old' }, '/home/me/new', 'linux'),
			'/home/me/old');
	});
});
