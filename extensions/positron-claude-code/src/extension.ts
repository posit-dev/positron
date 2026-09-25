/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ErrorActionRequest, formatPrompt, getClaudeCodeLaunch } from './claudeCodeLaunch';

/** Identifier of Anthropic's Claude Code extension. */
const CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code';

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-claude-code.sendError', sendError)
	);
}

/** Open a new Claude Code session with the error from a Fix/Explain action. */
async function sendError(request: ErrorActionRequest): Promise<void> {
	// Positron only offers this target when Claude Code is installed, but it
	// can be uninstalled or disabled after the buttons render.
	const claudeCode = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID);
	if (!claudeCode) {
		vscode.window.showErrorMessage(vscode.l10n.t('The Claude Code extension is not installed.'));
		return;
	}

	const version: string = claudeCode.packageJSON.version ?? '0.0.0';
	const useTerminal = vscode.workspace.getConfiguration('claudeCode').get<boolean>('useTerminal') === true;
	const launch = getClaudeCodeLaunch(formatPrompt(request), version, useTerminal);
	if (launch.kind === 'outdated') {
		vscode.window.showErrorMessage(vscode.l10n.t(
			'Sending errors to Claude Code requires Claude Code {0} or later. You have {1}.',
			launch.minimumVersion,
			version
		));
		return;
	}

	await vscode.commands.executeCommand(launch.command, ...launch.args);
}
