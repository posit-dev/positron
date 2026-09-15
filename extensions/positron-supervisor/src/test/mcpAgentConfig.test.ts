/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CLAUDE_MCP_ADD_ARGS, agentCliCommand } from '../McpAgentConfig';

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
