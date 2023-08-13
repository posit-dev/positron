/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronProxy } from './positronProxy';

/**
 * Activates the extension.
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Create the PositronProxy object.
	const positronProxy = new PositronProxy(context);

	// Add the positronProxy.startProxyServer command.
	context.subscriptions.push(
		vscode.commands.registerCommand('positronProxy.startProxyServer', async (target: string) => {
			return await positronProxy.startProxyServer(target);
		})
	);

	// Add the PositronProxy object.
	context.subscriptions.push(positronProxy);
}
