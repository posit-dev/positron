/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { ConnectionItem, ConnectionItemsProvider, isActiveConnectionItem, DatabaseConnectionItem, DisconnectedConnectionItem } from './connection';
import { PositronConnectionsComm } from './comms/ConnectionsComms';

/**
 * Activates the extension.
 *
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	const viewId = 'connections';
	const connectionProvider = new ConnectionItemsProvider(context);
	const connectionTreeView = vscode.window.createTreeView(viewId, { treeDataProvider: connectionProvider });

	// Register a handler for the positron.connection client type. This client
	// represents an active, queryable database connection.
	context.subscriptions.push(
		positron.runtime.registerClientHandler({
			clientType: 'positron.connection',
			callback: (client, params: any) => {
				connectionProvider.addConnection(
					new PositronConnectionsComm(client),
					params
				);
				return true;
			}
		}));

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positron.connections.removeFromHistory',
			(item: DisconnectedConnectionItem) => {
				connectionProvider.removeFromHistory(item);
			}
		));

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positron.connections.clearConnectionsHistory',
			() => {
				connectionProvider.clearConnectionsHistory();
			}
		));

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positron.connections.copyCodeToClipboard',
			(item: DisconnectedConnectionItem) => {
				const code = item.metadata.code;
				if (code) {
					vscode.env.clipboard.writeText(code);
				}
			}
		));

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positron.connections.reopenConnection',
			(item: DisconnectedConnectionItem) => {
				const code = item.metadata.code;
				if (code) {
					positron.runtime.executeCode(item.metadata.language_id, code, true);
				}
			}
		));

	// Register a command to preview a table
	context.subscriptions.push(
		vscode.commands.registerCommand('positron.connections.previewTable',
			(item: ConnectionItem) => {
				if (!isActiveConnectionItem(item)) {
					throw new Error('Only active connection items can be previewed');
				}

				item.preview().catch((e: any) => {
					vscode.window.showErrorMessage(`Error previewing '${item.name}': ${e.message}`);
				});
			}));

	context.subscriptions.push(
		vscode.commands.registerCommand('positron.connections.closeConnection',
			(item: DatabaseConnectionItem) => {
				item.close();
			}));

	context.subscriptions.push(
		vscode.commands.registerCommand('positron.connections.refresh',
			() => {
				connectionProvider.refresh();
			}));

	/* This is mostly used for testing purposes, to avoid requiring clicks in the UI */
	context.subscriptions.push(
		vscode.commands.registerCommand('positron.connections.expandAll',
			() => {
				connectionProvider.expandConnectionNodes(connectionTreeView);
			}));

	// this allows vscode.extensions.getExtension('vscode.positron-connections').exports
	// to acccess the ConnectionItemsProvider instance
	return connectionProvider;
}
