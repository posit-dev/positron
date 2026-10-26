/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import * as vscode from 'vscode';
import { getErrorActionPrompt, ProblemAction, showProblem } from 'positron-coding-agent-common';
import { CLAUDE_CODE_EXTENSION_ID, getClaudeCodeLaunch, openChat, openTerminal, USE_TERMINAL_SETTING } from './claudeCode';
import { getClaudeCodeMode } from './claudeCodeMode';

/** Claude Code's error action handler id. */
export const CLAUDE_CODE_ERROR_ACTION_HANDLER_ID = 'claude-code';

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

function openUseTerminalSetting(): ProblemAction {
	return {
		title: vscode.l10n.t('Open Settings'),
		run: () => vscode.commands.executeCommand('workbench.action.openSettings', USE_TERMINAL_SETTING),
	};
}
