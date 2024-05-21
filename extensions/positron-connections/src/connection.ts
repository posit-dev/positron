/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import path = require('path');
import fs = require('fs');
import { PositronConnectionsComm, ObjectSchema, FieldSchema } from './comms/ConnectionsComms';

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

enum ConnectionState {
	Active = 'active',
	Disconnected = 'disconnected',
}

interface ConnectionMetadata {
	name: string;
	language_id: string;
	// host and type are used to identify a unique connection
	host: string;
	type: string;
	code?: string;
	icon?: string; // base64 encoded icon image (if available)
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

	constructor(readonly name: string, readonly state: ConnectionState) { }
}

export function isDisconnectedConnectionItem(
	item: ConnectionItem
): item is DisconnectedConnectionItem {
	return item instanceof DisconnectedConnectionItem;
}

export class DisconnectedConnectionItem extends ConnectionItem {
	constructor(readonly metadata: ConnectionMetadata) {
		super(metadata.name, ConnectionState.Disconnected);
	}
	async icon() {
		if (this.metadata.icon) {
			return this.metadata.icon;
		}
		// we return an empty string to be consistent with what the active connections return
		return '';
	}
}

export function isActiveConnectionItem(
	item: ConnectionItem
): item is ActiveConnectionItem {
	return item instanceof ActiveConnectionItem;
}

export class ActiveConnectionItem extends ConnectionItem {
	constructor(
		readonly name: string,
		readonly kind: string,
		readonly path: Array<ObjectSchema>,
		readonly client: PositronConnectionsComm
	) {
		super(name, ConnectionState.Active);
	}

	async contains_data(): Promise<boolean> {
		return await this.client.containsData(this.path);
	}

	async icon() {
		return await this.client.getIcon(this.path);
	}

	async preview() {
		if (!this.contains_data()) {
			// This should never happen, as no UI is provided to preview data when the item
			// does not contain data.
			throw new Error('This item does not contain data');
		}

		await this.client.previewObject(this.path);
	}

	async listObjects(): Promise<Array<ObjectSchema>> {
		return await this.client.listObjects(this.path);
	}

	async listFields(): Promise<Array<FieldSchema>> {
		return await this.client.listFields(this.path);
	}

	close() {
		throw new Error('close() not implemented');
	}
}

function isDatabaseConnectionItem(
	item: ConnectionItem
): item is DatabaseConnectionItem {
	return item instanceof DatabaseConnectionItem;
}

/**
 * A connection item representing an active database connection (top-level)
 */
export class DatabaseConnectionItem extends ActiveConnectionItem {
	constructor(
		readonly metadata: ConnectionMetadata,
		readonly client: PositronConnectionsComm
	) {
		super(metadata.name, 'database', [], client);
		if (!metadata.icon) {
			this.icon().then((icon) => {
				if (icon !== '') {
					const uri = vscode.Uri.parse(icon);
					metadata.icon =
						'data:image/png;base64,' +
						fs.readFileSync(uri.fsPath, { encoding: 'base64' });
				}
			});
		}
	}

	override close() {
		this.client.dispose();
	}

	override async contains_data() {
		// database roots never contain data (even if empty) as they can't be a table itself
		return false;
	}
}

function isFieldConnectionItem(
	item: ConnectionItem
): item is FieldConnectionItem {
	return item instanceof FieldConnectionItem;
}

/**
 * A connection item representing a field in a table
 */
export class FieldConnectionItem extends ActiveConnectionItem {
	constructor(
		readonly name: string,
		readonly dtype: string,
		readonly client: PositronConnectionsComm
	) {
		super(name, 'field', [], client);
	}

	override async icon() {
		return ''; // fields can't have custom icons
	}

	override async contains_data() {
		return false;
	}
}

/**
 * Provides connection items to the Connections treeview.
 */
export class ConnectionItemsProvider
	implements vscode.TreeDataProvider<ConnectionItem> {
	// Fires when the tree data is changed. We fire this when a new connection
	// is created.
	private _onDidChangeTreeData: vscode.EventEmitter<
		ConnectionItem | undefined
	> = new vscode.EventEmitter<ConnectionItem | undefined>();

	// The list of active connections
	private _connections: (DatabaseConnectionItem | DisconnectedConnectionItem)[] = [];

	// The list of icons bundled for connections
	private _icons: { [key: string]: { light: vscode.Uri; dark: vscode.Uri } } = {};

	private treeItemDecorationProvider: TreeItemDecorationProvider =
		new TreeItemDecorationProvider();

	/**
	 * Create a new ConnectionItemsProvider instance
	 *
	 * @param context The extension context
	 */
	constructor(readonly context: vscode.ExtensionContext) {
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
		Object.values(ConnectionIcon).forEach((icon) => {
			this._icons[icon] = {
				light: vscode.Uri.file(path.join(context.extensionPath, 'media', `${icon}.svg`)),
				dark: vscode.Uri.file(path.join(context.extensionPath, 'media', `${icon}-dark.svg`))
			};
		});
		vscode.window.registerFileDecorationProvider(
			this.treeItemDecorationProvider
		);
		this._connections = this.context.workspaceState.keys().map((name) => {
			const metadata: ConnectionMetadata | undefined =
				this.context.workspaceState.get(name);
			if (metadata) {
				return new DisconnectedConnectionItem(metadata);
			} else {
				throw new Error('Unexpected state: connection metadata not found');
			}
		});
		this.fireOnDidChangeTreeData();
	}

	onDidChangeTreeData: vscode.Event<ConnectionItem | undefined> | undefined;

	/**
	 * Constructs a visual representation (TreeItem) from a ConnectionItem.
	 *
	 * @param item The item to get the tree item for
	 * @returns A TreeItem for the item
	 */
	async getTreeItem(item: ConnectionItem): Promise<vscode.TreeItem> {
		if (isDisconnectedConnectionItem(item)) {
			const treeItem = new vscode.TreeItem(
				item.name,
				vscode.TreeItemCollapsibleState.None
			);

			if (item.metadata.code) {
				treeItem.contextValue = 'disconnected-hasCode';
			} else {
				treeItem.contextValue = 'disconnected';
			}

			const icon = await item.icon();
			if (icon !== '') {
				treeItem.iconPath = vscode.Uri.parse(icon);
			} else {
				treeItem.iconPath = this._icons[ConnectionIcon.Database];
			}

			// this resourseUri is used by the FileDecorationProvider to show the connection
			// text with a slighy lighter font
			treeItem.resourceUri = vscode.Uri.parse(
				'connections://disconnected' + '.' + item.metadata.language_id
			);
			treeItem.tooltip = item.metadata.name;

			return treeItem;
		}

		if (!isActiveConnectionItem(item)) {
			throw new Error('Only ActiveConnectionItem instances are supported');
		}

		// Check if the item contains data
		// If that fails we want to quicly return a treeItem that is not ispectable
		let contains_data: boolean;
		try {
			contains_data = await item.contains_data();
		} catch (err: any) {
			// when contains_data fails, we show an error message that asks for a refresh.
			// we also display an error tree item instead, so we can proceed with the rest of the tree
			this.showErrorMessageWithRefresh(
				vscode.l10n.t(
					`Error checking if '{0}' contains_data: {1}`,
					item.name,
					err.message
				)
			);
			return this.errorTreeItem(item.name, err);
		}

		// Both databases and tables can be expanded.
		const collapsibleState = !isFieldConnectionItem(item);

		// Create the tree item.
		const treeItem = new vscode.TreeItem(
			item.name,
			collapsibleState
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None
		);

		treeItem.iconPath = await this.getTreeItemIcon(item);

		if (contains_data) {
			// if the item contains data, we set the contextValue enabling the UI for previewing the data
			treeItem.contextValue = 'table';
		}

		if (isFieldConnectionItem(item)) {
			// shows the field datatype as the treeItem description
			treeItem.description = '<' + item.dtype + '>';
		}

		if (isDatabaseConnectionItem(item)) {
			// adding the contextValue allows the TreView API to attach specific commands
			// to databases
			treeItem.contextValue = 'database';
			treeItem.tooltip = item.name;
			treeItem.resourceUri = vscode.Uri.parse(
				'connections://connected.' + item.metadata.language_id
			);
		}

		return treeItem;
	}

	async getTreeItemIcon(
		item: ActiveConnectionItem
	): Promise<vscode.Uri | { light: vscode.Uri; dark: vscode.Uri }> {
		try {
			const icon = await item.icon();
			if (icon !== '') {
				return vscode.Uri.file(icon);
			}
		} catch (err: any) {
			// not having an icon is not fatal as we can fallback to the type, but is worth notifying
			vscode.window.showErrorMessage(
				vscode.l10n.t(
					`Error getting icon for '{0}' : {1}`,
					item.name,
					err.message
				)
			);
		}

		// fallback to the item kind
		return this._icons[item.kind];
	}

	async showErrorMessageWithRefresh(message: string) {
		const answer = await vscode.window.showErrorMessage(message, {
			title: vscode.l10n.t('Retry'),
			execute: async () => {
				this.refresh();
			},
		});
		answer?.execute();
	}

	errorTreeItem(name: string, error: any): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(
			name,
			vscode.TreeItemCollapsibleState.None
		);
		treeItem.description = vscode.l10n.t('Error loading item.');
		treeItem.tooltip = error.message;
		treeItem.iconPath = new vscode.ThemeIcon(
			'error',
			new vscode.ThemeColor('errorForeground')
		);
		return treeItem;
	}

	/**
	 * Adds a connection to the pane.
	 *
	 * @param client The client instance that owns the connection
	 * @param name The name of the connection
	 */
	addConnection(client: PositronConnectionsComm, metadata: ConnectionMetadata) {
		// Add the connection to the list
		// if there's already a connection with the same name, we replace it
		const index = this._connections.findIndex((connection) => {
			return compareConnectionsMetadata(connection.metadata, metadata);
		});

		const conn = new DatabaseConnectionItem(metadata, client);
		if (index < 0) {
			this._connections.push(conn);
		} else {
			this._connections[index] = conn;
		}

		// they key is a combination of the language_id, host and the type, so we can identify the
		// connection uniquely
		this.context.workspaceState.update(
			makeConnectionKey(conn.metadata),
			conn.metadata
		);

		// Fire the event to indicate that the tree data has changed. This will
		// trigger a refresh.
		this.fireOnDidChangeTreeData();

		// Add an event listener to the client so that we can remove the
		// connection when it closes.
		client.instance.onDidChangeClientState(
			(state: positron.RuntimeClientState) => {
				if (state === positron.RuntimeClientState.Closed) {
					// Get the ID and discard the connection matching the ID
					const clientId = client.instance.getClientId();
					this._connections = this._connections.map((connection) => {
						if (!isActiveConnectionItem(connection)) {
							return connection;
						}

						if (connection.client.instance.getClientId() !== clientId) {
							return connection;
						}

						if (connection instanceof DatabaseConnectionItem) {
							return new DisconnectedConnectionItem(connection.metadata);
						}

						throw new Error('Unexpected connection type');
					});
					this.fireOnDidChangeTreeData();
				}
			}
		);

		client.onDidFocus(() => {
			vscode.commands.executeCommand('connections.focus', {
				preserveFocus: true,
			});
		});

		client.onDidUpdate(() => {
			this._onDidChangeTreeData.fire(undefined);
		});
	}

	/**
	 * Gets the children of an element.
	 *
	 * @param element The element to get the children for
	 * @returns The children of the element
	 */
	async getChildren(element?: ConnectionItem): Promise<ConnectionItem[]> {
		if (!element) {
			// At the root, return the top-level connections
			return this._connections;
		}

		if (!isActiveConnectionItem(element)) {
			// Non-active connections don't have children
			return [];
		}

		if (isFieldConnectionItem(element)) {
			// Fields don't have children
			return [];
		}

		let contains_data: boolean;
		try {
			// a failure here is unlikely as if contains_data() fails before, we would return a
			// non collapsible treeItem, this getChildren wouldn't be called.
			// anyway, if this happens we still send a retry notification and return no children.
			contains_data = await element.contains_data();
		} catch (err: any) {
			this.showErrorMessageWithRefresh(
				vscode.l10n.t(
					`Error checking if '{0}' contains_data: {1}`,
					element.name,
					err.message
				)
			);
			return [];
		}

		// The node is a view or a table so we want to get the fields on it.
		if (contains_data) {
			const fields = await element.listFields();
			return fields.map((field) => {
				return new FieldConnectionItem(field.name, field.dtype, element.client);
			});
		}

		// The node is a database, schema, or catalog, so we want to get the next set of elements in
		// the tree.
		const children = await element.listObjects();
		return children.map((obj) => {
			const path = [...element.path, { name: obj.name, kind: obj.kind }];
			return new ActiveConnectionItem(obj.name, obj.kind, path, element.client);
		});
	}

	public refresh() {
		this.fireOnDidChangeTreeData();
	}

	/**
	 * Removes a connection from the history.
	 *
	 * @param item The connection to remove
	 */
	removeFromHistory(item: DisconnectedConnectionItem) {
		this.context.workspaceState.update(makeConnectionKey(item.metadata), undefined);
		this._connections = this._connections.filter((connection) => {
			return !compareConnectionsMetadata(connection.metadata, item.metadata);
		});
		this.fireOnDidChangeTreeData();
	}

	/**
	 * Clears the connection history.
	 */
	clearConnectionsHistory() {
		this.context.workspaceState.keys().forEach((key) => {
			this.context.workspaceState.update(key, undefined);
		});
		this._connections = this._connections.filter((connection) => {
			return !isDisconnectedConnectionItem(connection);
		});
		this.fireOnDidChangeTreeData();
	}

	fireOnDidChangeTreeData() {
		this._onDidChangeTreeData.fire(undefined);
		this.treeItemDecorationProvider.updateFileDecorations([]);
	}
}

/**
 * Provides decorations for the Connections tree view.
 *
 * This provider is initialized by the TreeDataProvider and is used to modify the style of
 * the tree items in the Connections tree view.
 *
 */
export class TreeItemDecorationProvider
	implements vscode.FileDecorationProvider {
	private readonly _onDidChangeFileDecorations: vscode.EventEmitter<
		vscode.Uri | vscode.Uri[]
	> = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
	readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[]> =
		this._onDidChangeFileDecorations.event;

	provideFileDecoration(
		uri: vscode.Uri,
		token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.FileDecoration> {
		// https://code.visualstudio.com/api/references/theme-color#lists-and-trees
		if (uri.scheme === 'connections') {
			const [status, language_id] = uri.authority.split('.', 2);
			if (status === 'disconnected') {
				return {
					color: new vscode.ThemeColor('list.deemphasizedForeground'),
					// allow-any-unicode-next-line
					badge: '⭘', // we use this unicode character that symbolizes 'power off'
					tooltip: vscode.l10n.t('Disconnected'),
				};
			} else {
				return {
					badge: language_id.substring(0, 2),
					tooltip: vscode.l10n.t('Connected'),
				};
			}
		}

		return undefined;
	}

	updateFileDecorations(uris: vscode.Uri[]): void {
		this._onDidChangeFileDecorations.fire(uris);
	}
}

// Connections are considered identical if they have the same language_id, host, and type.
function compareConnectionsMetadata(a: ConnectionMetadata, b: ConnectionMetadata): boolean {
	return a.language_id === b.language_id &&
		a.host === b.host &&
		a.type === b.type;
}

function makeConnectionKey(metadata: ConnectionMetadata): string {
	return `language_id-${metadata.language_id}-host-${metadata.host}-type-${metadata.type}`;
}
