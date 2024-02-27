/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import path = require('path');

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
	 * @param client A reference to the client instance (comm) that owns the
	 *   item
	 */
	constructor(
		readonly name: string,
		readonly client: positron.RuntimeClientInstance) {
	}

	async icon(): Promise<string | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri }> {
		return '';
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
 * @param iconPath The path to an icon returned by the backend. If a path is not provided
 *  by the backend, the kind is used instead, to look up an icon in the extension's media
 * 	folder.
 */
export class ConnectionItemNode extends ConnectionItem {
	readonly kind: string;
	readonly path: Array<{ name: string; kind: string }>;
	private iconPath?: string | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri };
	private containsData?: boolean;

	constructor(readonly name: string, kind: string, path: Array<{ name: string; kind: string }>, client: positron.RuntimeClientInstance) {
		super(name, client);
		this.kind = kind;
		this.path = path;
	}

	async icon() {
		if (this.iconPath) {
			return this.iconPath;
		}

		const response = await this.client.performRpc({ msg_type: 'icon_request', path: this.path }) as any;

		if (response.icon) {
			this.iconPath = vscode.Uri.file(response.icon);
			return this.iconPath;
		}

		this.iconPath = this.kind;
		return this.iconPath;
	}

	override async contains_data() {
		if (this.containsData) {
			return this.containsData;
		}

		const response = await this.client.performRpc({ msg_type: 'contains_data_request', path: this.path }) as any;
		this.containsData = response.contains_data as boolean;

		return this.containsData;
	}

	async preview() {
		if (!this.contains_data()) {
			// This should never happen, as no UI is provided to preview data when the item
			// does not contain data.
			throw new Error('This item does not contain data');
		}
		await this.client.performRpc({ msg_type: 'preview_table', table: this.name, path: this.path });
	}
}

/**
 * A connection item representing a database connection (top-level)
 */
export class ConnectionItemDatabase extends ConnectionItemNode {
	constructor(readonly name: string, readonly client: positron.RuntimeClientInstance) {
		super(name, 'database', [], client);
	}

	close() {
		this.client.dispose();
	}
}

/**
 * A connection item representing a field in a table
 */
export class ConnectionItemField extends ConnectionItem {
	constructor(readonly name: string, readonly dtype: string, readonly client: positron.RuntimeClientInstance) {
		super(name, client);
		this.dtype = dtype;
	}

	override async icon() {
		return 'field';
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
	async getTreeItem(item: ConnectionItem): Promise<vscode.TreeItem> {
		// Both databases and tables can be expanded.
		const collapsibleState = item instanceof ConnectionItemNode;

		// Create the tree item.
		const treeItem = new vscode.TreeItem(item.name,
			collapsibleState ?
				vscode.TreeItemCollapsibleState.Collapsed :
				vscode.TreeItemCollapsibleState.None);

		treeItem.iconPath = await this.getTreeItemIcon(item);

		if (await item.contains_data()) {
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

	async getTreeItemIcon(item: ConnectionItem): Promise<vscode.Uri | { light: vscode.Uri; dark: vscode.Uri }> {
		const icon = await item.icon();

		if (typeof icon === 'string') {
			return this._icons[icon];
		}

		return icon;
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
	async getChildren(element?: ConnectionItemNode): Promise<ConnectionItem[]> {

		if (!element) {
			// At the root, return the top-level connections
			return this._connections;
		}

		// Fields don't have children
		if (element instanceof ConnectionItemField) {
			return [];
		}

		// The node is a view or a table so we want to get the fields on it.
		if (await element.contains_data()) {
			const response = await element.client.performRpc({ msg_type: 'fields_request', table: element.name, path: element.path }) as any;
			const fields = response.fields as Array<{ name: string; dtype: string }>;
			return fields.map((field) => {
				return new ConnectionItemField(field.name, field.dtype, element.client);
			});
		}

		// The node is a database, schema, or catalog, so we want to get the next set of elements in
		// the tree.
		const response = await element.client.performRpc({ msg_type: 'tables_request', name: element.name, kind: element.kind, path: element.path }) as any;
		const children = response.tables as Array<{ name: string; kind: string }>;
		return children.map((obj) => {
			const path = [...element.path, { name: obj.name, kind: obj.kind }];
			return new ConnectionItemNode(obj.name, obj.kind, path, element.client);
		});
	}
}
