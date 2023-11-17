/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import path = require('path');

/**
 * Base class for connection items.
 */
export class ConnectionItem {
	/**
	 * Create a new ConnectionItem instance
	 *
	 * @param name The name of the item
	 * @param client A reference to the client instance (comm) that owns the
	 *   item
	 */
	constructor(
		readonly name: string,
		readonly client: positron.RuntimeClientInstance) {
	}
}

/**
 * A connection item representing a database connection (top-level)
 */
export class ConnectionItemDatabase extends ConnectionItem {
}

/**
 * A connection item representing a table in a database
 */
export class ConnectionItemTable extends ConnectionItem {
	/**
	 * Preview the table's contents
	 */
	preview() {
		this.client.performRpc({ msg_type: 'preview_table', table: this.name });
	}
}

/**
 * A connection item representing a field in a table
 */
export class ConnectionItemField extends ConnectionItem {
}

/**
 * Provides connection items to the Connections treeview.
 */
export class ConnectionItemsProvider implements vscode.TreeDataProvider<ConnectionItem> {

	// Fires when the tree data is changed. We fire this when a new connection
	// is created.
	private _onDidChangeTreeData: vscode.EventEmitter<ConnectionItem | undefined> =
		new vscode.EventEmitter<ConnectionItem | undefined>();

	// The list of active connections
	private _connections: ConnectionItem[] = [];

	/**
	 * Create a new ConnectionItemsProvider instance
	 *
	 * @param context The extension context
	 */
	constructor(readonly context: vscode.ExtensionContext) {
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
	}

	onDidChangeTreeData: vscode.Event<ConnectionItem | undefined> | undefined;

	/**
	 * Constructs a visual representation (TreeItem) from a ConnectionItem.
	 *
	 * @param item The item to get the tree item for
	 * @returns A TreeItem for the item
	 */
	getTreeItem(item: ConnectionItem): vscode.TreeItem {
		// Both databases and tables can be expanded.
		const collapsibleState = item instanceof ConnectionItemDatabase || item instanceof ConnectionItemTable;

		// Create the tree item.
		const treeItem = new vscode.TreeItem(item.name,
			collapsibleState ?
				vscode.TreeItemCollapsibleState.Collapsed :
				vscode.TreeItemCollapsibleState.None);

		if (item instanceof ConnectionItemDatabase) {
			// Set the icon for databases
			treeItem.iconPath = vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'database.svg'));
		} else if (item instanceof ConnectionItemTable) {
			// Set the icon for tables
			treeItem.iconPath = vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'table.svg'));

			// Tables can previewed in a new editor
			treeItem.command = {
				title: vscode.l10n.t('Preview Table'),
				command: 'positron.connections.previewTable',
				tooltip: vscode.l10n.t(`Open ${item.name} in a new editor`),
				arguments: [item]
			};
		} else if (item instanceof ConnectionItemField) {
			// Set the icon for fields
			treeItem.iconPath = vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'field.svg'));
		}
		return treeItem;
	}

	/**
	 * Adds a connection to the pane.
	 *
	 * @param client The client instance that owns the connection
	 * @param name The name of the connection
	 */
	addConnection(client: positron.RuntimeClientInstance, name: string) {
		// Add the connection to the list
		this._connections.push(new ConnectionItemDatabase(name, client));

		// Fire the event to indicate that the tree data has changed. This will
		// trigger a refresh.
		this._onDidChangeTreeData.fire(undefined);

		// Add an event listener to the client so that we can remove the
		// connection when it closes.
		client.onDidChangeClientState((state: positron.RuntimeClientState) => {
			if (state === positron.RuntimeClientState.Closed) {
				// Get the ID and discard the connection matching the ID
				const clientId = client.getClientId();
				this._connections = this._connections.filter((connection) => {
					return connection.client.getClientId() !== clientId;
				});
				this._onDidChangeTreeData.fire(undefined);
			}
		});
	}

	/**
	 * Gets the children of an element.
	 *
	 * @param element The element to get the children for
	 * @returns The children of the element
	 */
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
