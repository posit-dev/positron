/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

class ConnectionItem {
	constructor(readonly name: string, readonly client: positron.RuntimeClientInstance) {
	}
}

class ConnectionItemDatabase extends ConnectionItem {
}

class ConnectionItemTable extends ConnectionItem {
}

class ConnectionItemField extends ConnectionItem {
}

/**
 * Stub implementation of a tree data provider.
 */
class ConnectionItemsProvider implements vscode.TreeDataProvider<ConnectionItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<ConnectionItem | undefined> =
		new vscode.EventEmitter<ConnectionItem | undefined>();
	private _connections: ConnectionItem[] = [];

	constructor() {
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
	}

	onDidChangeTreeData: vscode.Event<ConnectionItem | undefined> | undefined;

	getTreeItem(item: ConnectionItem): vscode.TreeItem {
		const collapsibleState = item instanceof ConnectionItemDatabase || item instanceof ConnectionItemTable;
		return new vscode.TreeItem(item.name, collapsibleState ? vscode.TreeItemCollapsibleState.Collapsed :
			vscode.TreeItemCollapsibleState.None);
	}

	addConnection(client: positron.RuntimeClientInstance, name: string) {
		this._connections.push(new ConnectionItemDatabase(name, client));
		this._onDidChangeTreeData.fire(undefined);
	}

	getChildren(element?: ConnectionItem): Thenable<ConnectionItem[]> {
		// Fields don't have children
		if (element instanceof ConnectionItemField) {
			return Promise.resolve([]);
		}

		if (element) {
			return new Promise((resolve, _reject) => {
				if (element instanceof ConnectionItemDatabase) {
					// The children of a database are the tables
					element.client.performRpc({ msg_type: 'tables_request' }).then(
						(response: any) => {
							const tables = response.tables as string[];
							const tableItems = tables.map((table) => {
								return new ConnectionItemTable(table, element.client);
							});
							resolve(tableItems);
						}
					);
				} else if (element instanceof ConnectionItemTable) {
					// The children of a table are the fields
					element.client.performRpc({ msg_type: 'fields_request' }).then(
						(response: any) => {
							const fields = response.fields as string[];
							const fieldItems = fields.map((field) => {
								return new ConnectionItemField(field, element.client);
							});
							resolve(fieldItems);
						}
					);
				}
			});
		} else {
			// At the root, return the top-level connections
			return Promise.resolve(this._connections);
		}

	}
}

/**
 * Activates the extension.
 *
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	const connectionProvider = new ConnectionItemsProvider();

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
}
