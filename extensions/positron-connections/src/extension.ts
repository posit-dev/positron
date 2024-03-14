/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { ConnectionItemDatabase, ConnectionItemNode, ConnectionItemsProvider } from './connection';
import { PositronConnectionsComm } from './comms/ConnectionsComms';

/**
 * Activates the extension.
 *
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	const connectionProvider = new ConnectionItemsProvider(context);

	// Register the tree data provider that will provide the connections
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('connections', connectionProvider));

	// Register a handler for the positron.connection client type. This client
	// represents an active, queryable database connection.
	context.subscriptions.push(
		positron.runtime.registerClientHandler({
			clientType: 'positron.connection',
			callback: (client, params: any) => {
				connectionProvider.addConnection(new PositronConnectionsComm(client), params.name);
				return true;
			}
		}));

	// Register a command to preview a table
	context.subscriptions.push(
		vscode.commands.registerCommand('positron.connections.previewTable',
			(item: ConnectionItemNode) => {
				try {
					item.preview();
				} catch (e: any) {
					// this is not fatal, but worth notifying
					vscode.window.showErrorMessage(`Error previewing '${item.name}': ${e.message}`);
				}
			}));

	context.subscriptions.push(
		vscode.commands.registerCommand('positron.connections.closeConnection',
			(item: ConnectionItemDatabase) => {
				item.close();
			}));

	context.subscriptions.push(
		vscode.commands.registerCommand('positron.connections.refresh',
			() => {
				connectionProvider.refresh();
			}));
}
