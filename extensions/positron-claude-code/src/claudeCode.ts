/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import * as vscode from 'vscode';
import { CommandLaunch, getCommandLaunch, getErrorActionPrompt, openPromptTerminal, ProblemAction, showProblem } from 'positron-coding-agent-common';
import { getClaudeCodeMode } from './claudeCodeMode';

/** Claude Code's error action handler id. */
export const CLAUDE_CODE_ERROR_ACTION_HANDLER_ID = 'claude-code';

/** Claude Code's name, which isn't translated. */
export const CLAUDE_CODE_LABEL = 'Claude Code';

/** Identifier of Anthropic's Claude Code extension. */
const CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code';

/** Claude Code's command-line tool. */
const CLAUDE_CODE_COMMAND = 'claude';

/** Claude Code's script in its npm package, run directly on Windows. */
const CLAUDE_CODE_NPM_SCRIPT = '@anthropic-ai/claude-code/cli.js';

/** Claude Code's setting for opening conversations in a terminal. */
const USE_TERMINAL_SETTING = 'claudeCode.useTerminal';

/** How long the launching notification shows, as in Claude Code's own terminals. */
const LAUNCHING_NOTIFICATION_DURATION = 2000;

/** Whether Claude Code is installed, as its extension or its command-line tool. */
export async function isClaudeCodeInstalled(): Promise<boolean> {
	return vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID) !== undefined ||
		await getClaudeCodeLaunch() !== undefined;
}

/** Claude Code as an error action handler. Each action starts a new conversation. */
export const claudeCodeErrorActionHandler: positron.ai.ErrorActionHandler = {
	ask: async (action, context) => {
		const extension = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID);
		// Read on each click, since the user can change it at any time.
		const useTerminal = vscode.workspace.getConfiguration().get<boolean>(USE_TERMINAL_SETTING) === true;
		// Only a terminal needs the command, so don't look for it otherwise.
		const launch = !extension || useTerminal ? await getClaudeCodeLaunch() : undefined;
		const mode = getClaudeCodeMode({
			extensionVersion: extension?.packageJSON.version ?? (extension ? '0.0.0' : undefined),
			useTerminal,
			hasCommand: launch !== undefined,
		});

		// A problem the user can fix: say why nothing was sent, without
		// waiting for them to answer.
		switch (mode) {
			case 'commandNotFound':
				void showProblem(
					vscode.window,
					vscode.l10n.t('Claude Code is set to open in a terminal, but the claude command was not found, so the error was not sent. Install the Claude Code command-line tool, or turn off Claude Code: Use Terminal.'),
					[openUseTerminalSetting()],
				);
				return;
			case 'tooOld':
				void showProblem(
					vscode.window,
					vscode.l10n.t('Claude Code {0} is too old to receive errors in its chat, so the error was not sent. Update it, or turn on Claude Code: Use Terminal.', extension?.packageJSON.version ?? ''),
					[
						{ title: vscode.l10n.t('Show Extension'), run: () => vscode.commands.executeCommand('extension.open', CLAUDE_CODE_EXTENSION_ID) },
						openUseTerminalSetting(),
					],
				);
				return;
		}

		const prompt = getErrorActionPrompt(action, context, vscode.workspace, vscode.l10n);
		if (mode === 'chat') {
			await openChat(prompt);
		} else if (launch) {
			openTerminal(launch, prompt, extension);
		}
	},
};

/** How to run `claude` without a shell, or undefined when it isn't installed. */
function getClaudeCodeLaunch() {
	return getCommandLaunch(CLAUDE_CODE_COMMAND, CLAUDE_CODE_NPM_SCRIPT);
}

function openUseTerminalSetting(): ProblemAction {
	return {
		title: vscode.l10n.t('Open Settings'),
		run: () => vscode.commands.executeCommand('workbench.action.openSettings', USE_TERMINAL_SETTING),
	};
}

/**
 * Open a new conversation in Claude Code's chat, with the prompt filled into
 * its input. Its API can't send it, so the user does.
 */
async function openChat(prompt: string): Promise<void> {
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
 * Start `claude` in a new terminal, which sends the prompt at once. Claude
 * Code's own terminal command types a quoted prompt into a shell instead,
 * which breaks on Windows and with multi-line prompts.
 */
function openTerminal(launch: CommandLaunch, prompt: string, extension: vscode.Extension<unknown> | undefined): void {
	// Match the terminals Claude Code opens itself: a brief notification while
	// it starts, and its logo.
	vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Claude Code launching...') },
		() => new Promise(resolve => setTimeout(resolve, LAUNCHING_NOTIFICATION_DURATION)),
	);
	openPromptTerminal(vscode.window, {
		name: CLAUDE_CODE_LABEL,
		launch,
		prompt,
		iconPath: extension && vscode.Uri.joinPath(extension.extensionUri, 'resources', 'claude-logo.svg'),
	});
}
