/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import path = require('path');
import { PositronConnectionsComm } from './comms/ConnectionsComms';

/**
 * Enumerates the possible types of connection icons
 */
enum ConnectionIcon {
	Database = 'database',
	Catalog = 'catalog',
	Schema = 'schema',
	Table = 'table',
	View = 'view',
	Field = 'field',
}

/**
 * Base class for connection items.
 */
export class ConnectionItem {
	/**
	 * Create a new ConnectionItem instance
	 *
	 * @param name The name of the item
	 * @param client A reference to the client instance (comm) that owns the item
	 */

	constructor(
		readonly name: string,
		readonly client: PositronConnectionsComm) {
	}

	async contains_data(): Promise<boolean> {
		return false;
	}
}

/**
 * A connection item representing a node in the tree objects allowed in
 * the database connection.
 *
 * @param kind The kind of the node (e.g. 'schema', 'table', etc.)
 * @param path The path to the node. This is represented as a list of tuples (name, type). Later,
 *   we can use the path to get the node children by doing something like
 * 	 `getChildren(schema='hello', table='world')`
 */
export class ConnectionItemNode extends ConnectionItem {
	readonly kind: string;
	readonly path: Array<{ name: string; kind: string }>;
	private _contains_data?: boolean;

	constructor(readonly name: string, kind: string, path: Array<{ name: string; kind: string }>, client: PositronConnectionsComm) {
		super(name, client);
		this.kind = kind;
		this.path = path;
	}

	async icon() {
		return await this.client.getIcon(this.path);
	}

	override async contains_data() {
		return await this.client.containsData(this.path);
	}

	async preview() {
		if (!this.contains_data()) {
			// This should never happen, as no UI is provided to preview data when the item
			// does not contain data.
			throw new Error('This item does not contain data');
		}

		await this.client.previewObject(this.path);
	}
}

/**
 * A connection item representing a database connection (top-level)
 */
export class ConnectionItemDatabase extends ConnectionItemNode {
	constructor(readonly name: string, readonly client: PositronConnectionsComm) {
		super(name, 'database', [], client);
	}

	close() {
		this.client.dispose();
	}

	async contains_data() {
		// database roots never contain data (even if empty) as they can't be a table itself
		return false;
	}
}

/**
 * A connection item representing a field in a table
 */
export class ConnectionItemField extends ConnectionItemNode {
	constructor(readonly name: string, readonly dtype: string, readonly client: PositronConnectionsComm) {
		super(name, 'field', [], client);
		this.dtype = dtype;
	}

	async icon() {
		return ''; // fields can't have custom icons
	}

	async contains_data() {
		return false;
	}
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

	// The list of icons bundled for connections
	private _icons: { [key: string]: vscode.Uri } = {};

	/**
	 * Create a new ConnectionItemsProvider instance
	 *
	 * @param context The extension context
	 */
	constructor(readonly context: vscode.ExtensionContext) {
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
		Object.values(ConnectionIcon).forEach((icon) => {
			this._icons[icon] = vscode.Uri.file(path.join(context.extensionPath, 'media', `${icon}.svg`));
		});
	}

	onDidChangeTreeData: vscode.Event<ConnectionItem | undefined> | undefined;

	/**
	 * Constructs a visual representation (TreeItem) from a ConnectionItem.
	 *
	 * @param item The item to get the tree item for
	 * @returns A TreeItem for the item
	 */
	async getTreeItem(item: ConnectionItemNode): Promise<vscode.TreeItem> {

		// Check if the item contains data
		// If that fails we want to quicly return a treeItem that is not ispectable
		let contains_data: boolean;
		try {
			contains_data = await item.contains_data();
		} catch (err: any) {
			// when contains_data fails, we show an error message that asks for a refresh.
			// we also display an error tree item instead, so we can proceed with the rest of the tree
			this.showErrorMessageWithRefresh(vscode.l10n.t(`Error checking if '{0}' contains_data: {1}`, item.name, err.message));
			return this.errorTreeItem(item.name, err);
		}

		// Both databases and tables can be expanded.
		const collapsibleState = !(item instanceof ConnectionItemField);

		// Create the tree item.
		const treeItem = new vscode.TreeItem(item.name,
			collapsibleState ?
				vscode.TreeItemCollapsibleState.Collapsed :
				vscode.TreeItemCollapsibleState.None);

		treeItem.iconPath = await this.getTreeItemIcon(item);

		if (contains_data) {
			// if the item contains data, we set the contextValue enabling the UI for previewing the data
			treeItem.contextValue = 'table';
		}

		if (item instanceof ConnectionItemField) {
			// shows the field datatype as the treeItem description
			treeItem.description = '<' + item.dtype + '>';
		}

		if (item instanceof ConnectionItemDatabase) {
			// adding the contextValue allows the TreView API to attach specific commands
			// to databases
			treeItem.contextValue = 'database';
		}

		return treeItem;
	}

	async getTreeItemIcon(item: ConnectionItemNode): Promise<vscode.Uri | { light: vscode.Uri; dark: vscode.Uri }> {
		try {
			const icon = await item.icon();
			if (icon !== '') {
				return vscode.Uri.file(icon);
			}
		} catch (err: any) {
			// not having an icon is not fatal as we can fallback to the type, but is worth notifying
			vscode.window.showErrorMessage(vscode.l10n.t(`Error getting icon for '{0}' : {1}`, item.name, err.message));
		}

		// fallback to the item kind
		return this._icons[item.kind];
	}

	async showErrorMessageWithRefresh(message: string) {
		const answer = await vscode.window.showErrorMessage(message,
			{
				title: vscode.l10n.t('Retry'),
				execute: async () => {
					this.refresh();
				}
			}
		);
		answer?.execute();
	}

	errorTreeItem(name: string, error: any): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
		treeItem.description = vscode.l10n.t('Error loading item.');
		treeItem.tooltip = error.message;
		treeItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
		return treeItem;
	}

	/**
	 * Adds a connection to the pane.
	 *
	 * @param client The client instance that owns the connection
	 * @param name The name of the connection
	 */
	addConnection(client: PositronConnectionsComm, name: string) {
		// Add the connection to the list
		this._connections.push(new ConnectionItemDatabase(name, client));

		// Fire the event to indicate that the tree data has changed. This will
		// trigger a refresh.
		this._onDidChangeTreeData.fire(undefined);

		// Add an event listener to the client so that we can remove the
		// connection when it closes.
		client.instance.onDidChangeClientState((state: positron.RuntimeClientState) => {
			if (state === positron.RuntimeClientState.Closed) {
				// Get the ID and discard the connection matching the ID
				const clientId = client.instance.getClientId();
				this._connections = this._connections.filter((connection) => {
					return connection.client.instance.getClientId() !== clientId;
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
	async getChildren(element?: ConnectionItemNode): Promise<ConnectionItem[]> {

		if (!element) {
			// At the root, return the top-level connections
			return this._connections;
		}

		// Fields don't have children
		if (element instanceof ConnectionItemField) {
			return [];
		}

		let contains_data: boolean;
		try {
			// a failure here is unlikely as if contains_data() fails before, we would return a
			// non collapsible treeItem, this getChildren wouldn't be called.
			// anyway, if this happens we still send a retry notification and return no children.
			contains_data = await element.contains_data();
		} catch (err: any) {
			this.showErrorMessageWithRefresh(vscode.l10n.t(`Error checking if '{0}' contains_data: {1}`, element.name, err.message));
			return [];
		}

		// The node is a view or a table so we want to get the fields on it.
		if (await element.contains_data()) {
			const fields = await element.client.listFields(element.path);
			return fields.map((field) => {
				return new ConnectionItemField(field.name, field.dtype, element.client);
			});
		}

		// The node is a database, schema, or catalog, so we want to get the next set of elements in
		// the tree.
		const children = await element.client.listObjects(element.path);
		return children.map((obj) => {
			const path = [...element.path, { name: obj.name, kind: obj.kind }];
			return new ConnectionItemNode(obj.name, obj.kind, path, element.client);
		});
	}

	public refresh() {
		this._onDidChangeTreeData.fire(undefined);
	}
}
