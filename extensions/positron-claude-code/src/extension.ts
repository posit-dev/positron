/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { CLAUDE_CODE_LABEL, isClaudeCodeInstalled } from './claudeCode';
import { CLAUDE_CODE_ERROR_ACTION_HANDLER_ID, claudeCodeErrorActionHandler } from './errorActionHandler';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	let errorActionHandler: vscode.Disposable | undefined;
	let isDisposed = false;
	context.subscriptions.push({
		dispose: () => {
			isDisposed = true;
			errorActionHandler?.dispose();
		}
	});

	// Checks run one at a time, so the registration follows the latest
	// result; a check requested during another runs once that one finishes.
	let isChecking = false;
	let isCheckRequested = false;
	const updateRegistration = async () => {
		if (isChecking) {
			isCheckRequested = true;
			return;
		}
		isChecking = true;
		try {
			do {
				isCheckRequested = false;
				const isInstalled = await isClaudeCodeInstalled();
				if (isDisposed) {
					return;
				}
				if (isInstalled && !errorActionHandler) {
					errorActionHandler = positron.ai.registerErrorActionHandler(
						CLAUDE_CODE_ERROR_ACTION_HANDLER_ID,
						CLAUDE_CODE_LABEL,
						claudeCodeErrorActionHandler,
						// Its API can't send to an existing conversation.
						{ supportsChatContinuation: false },
					);
				} else if (!isInstalled && errorActionHandler) {
					errorActionHandler.dispose();
					errorActionHandler = undefined;
				}
			} while (isCheckRequested);
		} finally {
			isChecking = false;
		}
	};

	// The command-line tool is looked for here and on extension changes only:
	// nothing announces one being installed or removed.
	context.subscriptions.push(vscode.extensions.onDidChange(() => updateRegistration()));
	// Register during activation, as with commands and tools.
	await updateRegistration();
}
