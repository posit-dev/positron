/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { CatalogTreeDataProvider } from "./catalog";

export function activate(context: vscode.ExtensionContext) {
	console.log('"positron-catalogs" is now active!');
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider(
			"positron-catalog-explorer",
			new CatalogTreeDataProvider(),
		),
	);
}

export function deactivate() {}
