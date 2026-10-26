/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { CommandLaunch } from './commandLaunch';

/** How to open an agent's terminal. */
export interface PromptTerminalOptions {
	/** The terminal's name, e.g. the agent's label. */
	readonly name: string;
	/** How to run the agent's command-line tool, from {@link getCommandLaunch}. */
	readonly launch: CommandLaunch;
	/** The prompt, passed as the command's last argument. */
	readonly prompt: string;
	/** The terminal's icon, e.g. the agent's logo. */
	readonly iconPath?: vscode.IconPath;
}

/**
 * Start an agent's command-line tool in a new terminal, which sends the
 * prompt at once. The tool is the terminal's process, with the prompt as its
 * last argument, so the prompt needs no shell quoting, keeps its newlines, and
 * stays out of shell history. The terminal opens as an editor tab beside the
 * active editor, isn't restored after a reload, and closes when the tool
 * exits.
 * @param window `vscode.window`.
 */
export function openPromptTerminal(window: Pick<typeof vscode.window, 'createTerminal'>, options: PromptTerminalOptions): vscode.Terminal {
	const terminal = window.createTerminal({
		name: options.name,
		shellPath: options.launch.command,
		shellArgs: [...options.launch.args, options.prompt],
		iconPath: options.iconPath,
		// `vscode.ViewColumn.Beside`, which can't be imported here.
		location: { viewColumn: -2 },
		isTransient: true,
	});
	terminal.show();
	return terminal;
}
