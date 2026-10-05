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
	isAvailable: () => resolveOnPath('codex') !== undefined,
	isAgentCommand: isCodexCommand,
	startNew,
};

/** Start `codex` in a new terminal with the prompt. */
async function startNew(prompt: ErrorPrompt): Promise<void> {
	const shellPath = resolveOnPath('codex');
	if (!shellPath) {
		throw new Error(vscode.l10n.t('Codex is not installed: `codex` was not found on the PATH.'));
	}
	// Run Codex as the terminal's process rather than typing a command into a
	// shell, so the prompt needs no shell quoting.
	const text = canInlineBody(prompt) ? formatInlinePrompt(prompt) : await formatPromptWithFile(prompt);
	const terminal = vscode.window.createTerminal({ name: 'Codex', shellPath, shellArgs: [text] });
	terminal.show();
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
