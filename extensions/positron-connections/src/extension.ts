/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { ConnectionItemTable, ConnectionItemsProvider } from './connection';

/**
 * Activates the extension.
 *
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	const connectionProvider = new ConnectionItemsProvider(context);

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('connections', connectionProvider));

	context.subscriptions.push(
		positron.runtime.registerClientHandler({
			clientType: 'positron.connection',
			callback: (client, params: any) => {
				// Presume that the params are a connection name
				connectionProvider.addConnection(client, params.name);
				return true;
			}
		}));

	context.subscriptions.push(
		vscode.commands.registerCommand('positron.connections.previewTable',
			(item: ConnectionItemTable) => {
				item.preview();
			}));
}
