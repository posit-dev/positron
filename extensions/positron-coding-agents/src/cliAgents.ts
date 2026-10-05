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

/**
 * Codex, through its CLI. Its VS Code extension has no command that takes a
 * prompt; `codex <prompt>` starts an interactive session that sends it.
 */
export const codex = createCliAgent('codex', 'Codex', 'codex', prompt => [prompt]);

/**
 * Gemini CLI. Its VS Code companion extension only runs `gemini` in a
 * terminal; `-i` sends a prompt and keeps the session interactive.
 */
export const gemini = createCliAgent('gemini', 'Gemini CLI', 'gemini', prompt => ['-i', prompt]);

/**
 * An agent that runs its CLI in a new terminal with the prompt as an argument.
 * @param getArgs The command-line arguments that start a session with a prompt.
 */
function createCliAgent(
	id: string,
	label: string,
	executable: string,
	getArgs: (prompt: string) => string[],
): CodingAgent {
	return {
		id,
		label,
		isAvailable: () => resolveOnPath(executable) !== undefined,
		start: async (prompt: ErrorPrompt) => {
			const shellPath = resolveOnPath(executable);
			if (!shellPath) {
				throw new Error(vscode.l10n.t('{0} is not installed: `{1}` was not found on the PATH.', label, executable));
			}
			// Run the CLI as the terminal's process rather than typing a
			// command into a shell, so the prompt needs no shell quoting.
			const text = canInlineBody(prompt) ? formatInlinePrompt(prompt) : await formatPromptWithFile(prompt);
			const terminal = vscode.window.createTerminal({ name: label, shellPath, shellArgs: getArgs(text) });
			terminal.show();
		},
	};
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
