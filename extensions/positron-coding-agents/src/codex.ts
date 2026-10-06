/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CodingAgent, formatPromptWithFile } from './codingAgent';
import { canInlineBody, ErrorPrompt, formatInlinePrompt } from './errorPrompt';
import { isCodexCommand } from './foregroundProcess';

/**
 * Codex, through its CLI. Its VS Code extension has no command that takes a
 * prompt; `codex <prompt>` starts an interactive session that sends it.
 */
export const codex: CodingAgent = {
	id: 'codex',
	label: 'Codex',
	isAvailable: () => getLaunch() !== undefined,
	isAgentCommand: isCodexCommand,
	startNew,
};

/** Start `codex` in a new terminal with the prompt. */
async function startNew(prompt: ErrorPrompt): Promise<void> {
	const launch = getLaunch();
	if (!launch) {
		throw new Error(vscode.l10n.t('Codex is not installed: `codex` was not found on the PATH.'));
	}
	// Run Codex as the terminal's process rather than typing a command into a
	// shell, so the prompt needs no shell quoting.
	const text = canInlineBody(prompt) ? formatInlinePrompt(prompt) : await formatPromptWithFile(prompt);
	const terminal = vscode.window.createTerminal({ name: 'Codex', shellPath: launch.command, shellArgs: [...launch.args, text] });
	terminal.show();
}

/**
 * Find how to launch Codex without going through a shell.
 *
 * Windows cannot execute npm's `codex.cmd` launcher directly, and running it
 * under `cmd.exe` would re-parse the prompt (newlines, quotes, `%`, `&`). So
 * run the script the launcher points to under Node instead, as it would.
 * @returns The command and leading arguments, or undefined when Codex is not
 *   on the PATH or is behind a launcher this cannot see through.
 */
function getLaunch(): { command: string; args: string[] } | undefined {
	const executable = resolveOnPath('codex');
	if (!executable) {
		return undefined;
	}
	if (!/\.(cmd|bat)$/i.test(executable)) {
		return { command: executable, args: [] };
	}

	// npm puts the package next to its launcher, and the launcher prefers a
	// node.exe beside it over the one on the PATH.
	const directory = path.dirname(executable);
	const script = path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
	const localNode = path.join(directory, 'node.exe');
	const node = fs.existsSync(localNode) ? localNode : resolveOnPath('node');
	if (!node || !fs.existsSync(script)) {
		return undefined;
	}
	return { command: node, args: [script] };
}

/**
 * Find an executable on the PATH, including Windows launchers like
 * `codex.cmd`. Mirrors positron-supervisor's lookup for its MCP agents.
 * @returns The executable's path, or undefined when it is not on the PATH.
 */
function resolveOnPath(executable: string): string | undefined {
	const directories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
	const names = os.platform() === 'win32'
		? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map(ext => executable + ext)
		: [executable];
	for (const directory of directories) {
		for (const name of names) {
			const candidate = path.join(directory, name);
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}
