/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import * as vscode from 'vscode';
import { CLAUDE_CODE_EXTENSION_ID, getClaudeCodeLaunch, openChat, openTerminal, USE_TERMINAL_SETTING } from './claudeCode';
import { getErrorPrompt } from './errorPrompt';
import { isAtLeast } from './version';

/**
 * First Claude Code extension release whose `claude-vscode.editor.open`
 * command accepts an initial prompt (2025-11-06). Older releases ignore it.
 */
const MIN_CHAT_VERSION = '2.0.35';

/** Claude Code as an error action handler. Each action starts a new conversation. */
export const claudeCodeErrorActionHandler: positron.ai.ErrorActionHandler = {
	ask: async (action, context) => {
		const extension = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID);
		// Read on each click, since the user can change it at any time.
		const useTerminal = vscode.workspace.getConfiguration().get<boolean>(USE_TERMINAL_SETTING) === true;

		// Follow the user's `claudeCode.useTerminal`: Claude Code has no command
		// that takes a prompt and applies the setting itself. Without the
		// extension, only the command can be installed.
		if (!extension || useTerminal) {
			const launch = await getClaudeCodeLaunch();
			// Say why nothing was sent, without waiting for the user to answer.
			if (!launch && !extension) {
				void vscode.window.showWarningMessage(
					vscode.l10n.t('Claude Code is not installed, or the claude command is not on the PATH, so the error was not sent.'),
				);
				return;
			}
			if (!launch) {
				const openSettings = vscode.l10n.t('Open Settings');
				void vscode.window.showWarningMessage(
					vscode.l10n.t('Claude Code is set to open in a terminal, but the claude command was not found, so the error was not sent. Install the Claude Code command-line tool, or turn off Claude Code: Use Terminal.'),
					openSettings,
				).then(choice => {
					if (choice === openSettings) {
						void openUseTerminalSetting();
					}
				});
				return;
			}
			openTerminal(launch, getErrorPrompt(action, context), extension);
			return;
		}

		const version = String(extension.packageJSON.version ?? '');
		if (!isAtLeast(version, MIN_CHAT_VERSION)) {
			const showExtension = vscode.l10n.t('Show Extension');
			const openSettings = vscode.l10n.t('Open Settings');
			void vscode.window.showWarningMessage(
				vscode.l10n.t('Claude Code {0} is too old to receive errors in its chat, so the error was not sent. Update it, or turn on Claude Code: Use Terminal.', version),
				showExtension,
				openSettings,
			).then(choice => {
				if (choice === showExtension) {
					void vscode.commands.executeCommand('extension.open', CLAUDE_CODE_EXTENSION_ID);
				} else if (choice === openSettings) {
					void openUseTerminalSetting();
				}
			});
			return;
		}
		await openChat(getErrorPrompt(action, context));
	},
};

function openUseTerminalSetting(): Thenable<unknown> {
	return vscode.commands.executeCommand('workbench.action.openSettings', USE_TERMINAL_SETTING);
}
