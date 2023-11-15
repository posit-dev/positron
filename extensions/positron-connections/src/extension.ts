/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Stub implementation of a tree data provider.
 */
class ConnectionItemsProvider implements vscode.TreeDataProvider<string> {
	getTreeItem(element: string): vscode.TreeItem {
		return new vscode.TreeItem(element);
	}

	getChildren(element?: string): Thenable<string[]> {
		if (element) {
			return Promise.resolve([]);
		} else {
			return Promise.resolve(['stub']);
		}
	}
}

/**
 * Activates the extension.
 *
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	vscode.window.registerTreeDataProvider('connections', new ConnectionItemsProvider());
}
