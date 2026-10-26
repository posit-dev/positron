/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** How to run a command-line tool as a terminal's process, without a shell. */
export interface CommandLaunch {
	readonly command: string;
	readonly args: readonly string[];
}

/**
 * Find how to launch a command-line tool without going through a shell, so a
 * prompt passed as an argument needs no quoting.
 *
 * Windows cannot execute npm's batch launchers (e.g. `claude.cmd`) directly,
 * and running one under `cmd.exe` would re-parse the prompt (newlines,
 * quotes, `%`, `&`). So run the script the launcher points to under Node
 * instead, as the launcher would.
 * @param executable The CLI's name, e.g. "claude".
 * @param npmScript The CLI's script within `node_modules`, e.g.
 *   "@anthropic-ai/claude-code/cli.js".
 * @returns The launch, or undefined when the CLI is not on the PATH, or is
 *   only behind batch launchers that are not npm's.
 */
export async function getCommandLaunch(executable: string, npmScript: string): Promise<CommandLaunch | undefined> {
	// Skip a batch launcher that isn't npm's (e.g. pnpm's, or one left behind
	// by an uninstall) rather than give up, since a later one may run.
	for (const executablePath of await findOnPath(executable)) {
		if (!/\.(cmd|bat)$/i.test(executablePath)) {
			return { command: executablePath, args: [] };
		}

		// npm puts the package next to its launcher, and the launcher prefers a
		// node.exe beside it over the one on the PATH.
		const directory = path.dirname(executablePath);
		const script = path.join(directory, 'node_modules', ...npmScript.split('/'));
		if (!await isFile(script)) {
			continue;
		}
		const localNode = path.join(directory, 'node.exe');
		const node = await isFile(localNode) ? localNode : (await findOnPath('node'))[0];
		if (node) {
			return { command: node, args: [script] };
		}
	}
	return undefined;
}

/**
 * Find an executable on the PATH, including Windows launchers like
 * `claude.cmd`. Mirrors positron-supervisor's lookup for its MCP agents.
 * @returns Every match, in PATH order.
 */
async function findOnPath(executable: string): Promise<string[]> {
	const directories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
	const names = os.platform() === 'win32'
		? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map(ext => executable + ext)
		: [executable];
	// Check every candidate at once, so one slow directory doesn't hold up
	// the rest, and keep them in PATH order.
	const candidates = directories.flatMap(directory => names.map(name => path.join(directory, name)));
	const found = await Promise.all(candidates.map(candidate => isExecutable(candidate)));
	return candidates.filter((_, i) => found[i]);
}

/**
 * Whether a file exists, and isn't a directory. Asynchronous so that a slow
 * or hung network mount on the PATH can't block the extension host.
 */
async function isFile(file: string): Promise<boolean> {
	try {
		return (await fs.promises.stat(file)).isFile();
	} catch {
		return false;
	}
}

/**
 * Whether a file can be run. Windows has no execute permission; its
 * executables are found by their PATHEXT extension instead.
 */
async function isExecutable(file: string): Promise<boolean> {
	if (!await isFile(file)) {
		return false;
	}
	if (os.platform() === 'win32') {
		return true;
	}
	try {
		await fs.promises.access(file, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
