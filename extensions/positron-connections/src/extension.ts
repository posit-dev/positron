/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

/**
 * Stub implementation of a tree data provider.
 */
class ConnectionItemsProvider implements vscode.TreeDataProvider<string> {
	private _onDidChangeTreeData: vscode.EventEmitter<string | undefined> = new vscode.EventEmitter<string | undefined>();
	private _connections: string[] = [];

	constructor() {
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
	}

	onDidChangeTreeData: vscode.Event<string | undefined> | undefined;

	getTreeItem(element: string): vscode.TreeItem {
		return new vscode.TreeItem(element);
	}

	addConnection(name: string) {
		this._connections.push(name);
		this._onDidChangeTreeData.fire(undefined);
	}

	getChildren(element?: string): Thenable<string[]> {
		return Promise.resolve(this._connections);
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
			callback: (client, params: object) => {
				// Presume that the params are a connection name
				const name = params as any as string;
				connectionProvider.addConnection(name);
				return true;
			}
		}));
}
