/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { CLAUDE_CODE_ERROR_ACTION_HANDLER_ID, claudeCodeErrorActionHandler } from './errorActionHandler';

export function activate(context: vscode.ExtensionContext): void {
	// Register during activation, as with commands and tools. The handler says
	// what's missing when Claude Code isn't installed.
	context.subscriptions.push(positron.ai.registerErrorActionHandler(CLAUDE_CODE_ERROR_ACTION_HANDLER_ID, claudeCodeErrorActionHandler));
}
