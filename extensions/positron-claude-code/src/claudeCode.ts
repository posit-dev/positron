/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CommandLaunch, getCommandLaunch } from './commandLaunch';

/** Claude Code's name, which isn't translated. */
const CLAUDE_CODE_LABEL = 'Claude Code';

/** Identifier of Anthropic's Claude Code extension. */
export const CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code';

/** Claude Code's command-line tool. */
const CLAUDE_CODE_COMMAND = 'claude';

/** Claude Code's script in its npm package, run directly on Windows. */
const CLAUDE_CODE_NPM_SCRIPT = '@anthropic-ai/claude-code/cli.js';

/** Claude Code's setting for opening conversations in a terminal. */
export const USE_TERMINAL_SETTING = 'claudeCode.useTerminal';

/** How long the launching notification shows, as in Claude Code's own terminals. */
const LAUNCHING_NOTIFICATION_DURATION = 2000;

/** How to run `claude` without a shell, or undefined when it isn't installed. */
export function getClaudeCodeLaunch() {
	return getCommandLaunch(CLAUDE_CODE_COMMAND, CLAUDE_CODE_NPM_SCRIPT);
}

/**
 * Open a new conversation in Claude Code's chat, with the prompt filled into
 * its input. Its API can't send it, so the user does.
 */
export async function openChat(prompt: string): Promise<void> {
	// An undefined session ID starts a new conversation. 'honor-preferred-location'
	// opens the chat where the user keeps it (the sidebar or an editor tab).
	// Without it, Claude Code always opens a tab and switches the user's
	// preferred location to tabs.
	await vscode.commands.executeCommand(
		'claude-vscode.editor.open',
		undefined,
		prompt,
		undefined,
		undefined,
		undefined,
		{ programmatic: 'honor-preferred-location' }
	);

	// Focus the input so Enter sends the prompt.
	await vscode.commands.executeCommand('claude-vscode.focus').then(undefined, () => { });
}

/**
 * Start `claude` in a new terminal, which sends the prompt at once.
 *
 * Positron opens its own terminal rather than running Claude Code's
 * `claude-vscode.terminal.open` (checked in v2.1.310), which starts a shell and
 * types the quoted command line into it. That breaks on Windows and with long
 * or multi-line prompts, and leaves the prompt in shell history. Here `claude`
 * is the terminal's process, with the prompt as its last argument, so the
 * prompt needs no quoting and keeps its newlines.
 */
export function openTerminal(launch: CommandLaunch, prompt: string, extension: vscode.Extension<unknown> | undefined): void {
	// Match the terminals Claude Code opens itself: a brief notification while
	// it starts, then an editor tab beside the active editor, with its logo,
	// not restored after a reload. The terminal closes when `claude` exits.
	vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Claude Code launching...') },
		() => new Promise(resolve => setTimeout(resolve, LAUNCHING_NOTIFICATION_DURATION)),
	);
	const terminal = vscode.window.createTerminal({
		name: CLAUDE_CODE_LABEL,
		shellPath: launch.command,
		shellArgs: [...launch.args, prompt],
		iconPath: extension && vscode.Uri.joinPath(extension.extensionUri, 'resources', 'claude-logo.svg'),
		location: { viewColumn: vscode.ViewColumn.Beside },
		isTransient: true,
	});
	terminal.show();
}
