/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { CatalogTreeDataProvider } from "./catalog";
import { DefaultDatabricksCredentialProvider } from "./credentials";
import { getDatabricksCatalogs } from "./catalogs/databricks";
import { registerDbfsProvider } from "./fs/dbfs";
import { setExtensionUri } from "./resources";

export async function activate(context: vscode.ExtensionContext) {
	setExtensionUri(context);
	console.log('"positron-catalogs" is now active!');
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider(
			"positron-catalog-explorer",
			new CatalogTreeDataProvider(
				...(await getDatabricksCatalogs(context)),
			),
		),
		registerDbfsProvider(
			new DefaultDatabricksCredentialProvider(
				context.secrets,
			),
		),
	);
}

export function deactivate() {}
