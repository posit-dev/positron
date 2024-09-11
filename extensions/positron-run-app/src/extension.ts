/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const log = vscode.window.createOutputChannel('Positron App Runners', { log: true });

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	context.subscriptions.push(log);
}
