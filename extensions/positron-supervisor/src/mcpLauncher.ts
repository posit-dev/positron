/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { McpLaunch } from './McpAgents';
import { mcpConnectionsDirectory } from './mcpConnection';

/**
 * Where the launcher is kept: the connections directory, which does not move
 * when Positron is updated, so an agent configured to start it never has to be
 * reconfigured.
 *
 * @param storageUri The extension's global storage directory.
 * @returns The path to the launcher.
 */
export function mcpLauncherPath(storageUri: vscode.Uri): string {
	const name = os.platform() === 'win32' ? 'positron-mcp.cmd' : 'positron-mcp';
	return path.join(mcpConnectionsDirectory(storageUri), 'bin', name);
}

/**
 * The command line agents start the launcher with. The script is handed to its
 * shell rather than run directly: on macOS and Linux so it works from a home
 * directory mounted `noexec`, and on Windows because Node refuses to spawn a
 * batch file without a shell. `/d` skips the user's AutoRun commands, whose
 * output would corrupt the MCP stream.
 *
 * @param storageUri The extension's global storage directory.
 * @returns The launch to write into an agent's configuration.
 */
export function mcpLauncherLaunch(storageUri: vscode.Uri): McpLaunch {
	const launcher = mcpLauncherPath(storageUri);
	return os.platform() === 'win32'
		? { command: 'cmd.exe', args: ['/d', '/c', launcher] }
		: { command: '/bin/sh', args: [launcher] };
}

/**
 * Write the launcher script, which runs the given supervisor binary's stdio
 * bridge, unless it already does.
 *
 * @param storageUri The extension's global storage directory.
 * @param supervisorPath The supervisor binary.
 * @param log Writes a line to the Kernel Supervisor output channel.
 */
export async function installMcpLauncher(
	storageUri: vscode.Uri,
	supervisorPath: string,
	log: (message: string) => void,
): Promise<void> {
	const target = mcpLauncherPath(storageUri);
	const connections = mcpConnectionsDirectory(storageUri);
	const script = os.platform() === 'win32'
		// One line, which cmd parses whole before running it, so a script
		// rewritten while an agent's bridge is running cannot have the rest
		// of the new one read in after the bridge exits.
		? `@${batchQuote(supervisorPath)} mcp-stdio --connections ${batchQuote(connections)} %* & exit /b\r\n`
		: '#!/bin/sh\n' +
		`exec ${shellQuote(supervisorPath)} mcp-stdio --connections ${shellQuote(connections)} "$@"\n`;
	if (await fs.readFile(target, 'utf8').catch(() => undefined) === script) {
		return;
	}

	log(`Writing ${target}, which coding agents start as Positron's MCP server, to run ${supervisorPath}`);
	await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
	// Written beside the launcher and renamed over it, so an agent starting it
	// never finds half a file.
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporary, script, { mode: 0o755 });
		await fs.rename(temporary, target);
	} finally {
		await fs.rm(temporary, { force: true });
	}
}

/** Quote a string for a POSIX shell. */
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Quote a path for a batch file, which expands `%` even inside quotes. */
function batchQuote(value: string): string {
	return `"${value.replace(/%/g, '%%')}"`;
}
