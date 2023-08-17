/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronProxy } from './positronProxy';

/**
 * Activates the extension.
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Create the PositronProxy object.
	const positronProxy = new PositronProxy(context);

	// Register the positronProxy.startHelpProxyServer command and add its disposable.
	context.subscriptions.push(vscode.commands.registerCommand('positronProxy.startHelpProxyServer', async (targetOrigin: string) => {
		return await positronProxy.startHelpProxyServer(targetOrigin);
	}));

	// Add the PositronProxy object disposable.
	context.subscriptions.push(positronProxy);
}
