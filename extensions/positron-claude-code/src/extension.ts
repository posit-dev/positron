/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { claudeCodeErrorActionHandler } from './errorActionHandler';

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(positron.ai.registerErrorActionHandler('claude-code', claudeCodeErrorActionHandler));
}
