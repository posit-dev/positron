/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** How to run an agent's CLI as a terminal's process, without a shell. */
export interface AgentLaunch {
	readonly command: string;
	readonly args: readonly string[];
}

/**
 * Find how to launch an agent's CLI without going through a shell, so a
 * prompt passed as an argument needs no quoting.
 *
 * Windows cannot execute npm's batch launchers (e.g. `codex.cmd`) directly,
 * and running one under `cmd.exe` would re-parse the prompt (newlines,
 * quotes, `%`, `&`). So run the script the launcher points to under Node
 * instead, as the launcher would.
 * @param executable The CLI's name, e.g. "codex".
 * @param npmScript The CLI's script within `node_modules`, e.g.
 *   "@openai/codex/bin/codex.js".
 * @returns The launch, or undefined when the CLI is not on the PATH or is
 *   behind a batch launcher that is not npm's.
 */
export async function getAgentLaunch(executable: string, npmScript: string): Promise<AgentLaunch | undefined> {
	const executablePath = await resolveOnPath(executable);
	if (!executablePath) {
		return undefined;
	}
	if (!/\.(cmd|bat)$/i.test(executablePath)) {
		return { command: executablePath, args: [] };
	}

	// npm puts the package next to its launcher, and the launcher prefers a
	// node.exe beside it over the one on the PATH.
	const directory = path.dirname(executablePath);
	const script = path.join(directory, 'node_modules', ...npmScript.split('/'));
	const localNode = path.join(directory, 'node.exe');
	const node = await exists(localNode) ? localNode : await resolveOnPath('node');
	if (!node || !await exists(script)) {
		return undefined;
	}
	return { command: node, args: [script] };
}

/**
 * Find an executable on the PATH, including Windows launchers like
 * `codex.cmd`. Mirrors positron-supervisor's lookup for its MCP agents.
 * @returns The executable's path, or undefined when it is not on the PATH.
 */
async function resolveOnPath(executable: string): Promise<string | undefined> {
	const directories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
	const names = os.platform() === 'win32'
		? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map(ext => executable + ext)
		: [executable];
	for (const directory of directories) {
		for (const name of names) {
			const candidate = path.join(directory, name);
			if (await exists(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

/**
 * Whether a file exists. Asynchronous so that a slow or hung network mount on
 * the PATH can't block the extension host.
 */
async function exists(file: string): Promise<boolean> {
	try {
		await fs.promises.access(file);
		return true;
	} catch {
		return false;
	}
}
