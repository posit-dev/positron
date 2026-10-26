/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { registerWhileInstalled } from 'positron-coding-agent-common';
import { CLAUDE_CODE_ERROR_ACTION_HANDLER_ID, CLAUDE_CODE_LABEL, claudeCodeErrorActionHandler, isClaudeCodeInstalled } from './claudeCode';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	// Register Claude Code while it's installed, so the `ai.errorActions.agent`
	// setting lists it. Once activated, it stays registered while `ai.enabled`
	// is off, which Positron already enforces, so the setting keeps listing it.
	const registration = registerWhileInstalled(
		isClaudeCodeInstalled,
		() => positron.ai.registerErrorActionHandler(
			CLAUDE_CODE_ERROR_ACTION_HANDLER_ID,
			CLAUDE_CODE_LABEL,
			claudeCodeErrorActionHandler,
			// Its API can't send to an existing conversation.
			{ supportsChatContinuation: false },
		),
	);
	context.subscriptions.push(registration);

	// The command-line tool is looked for here and on extension changes only:
	// nothing announces one being installed or removed.
	context.subscriptions.push(vscode.extensions.onDidChange(() => registration.update()));
	// Finish activating once registered, since a click that arrives before
	// then activates this extension and waits for it.
	await registration.update();
}
