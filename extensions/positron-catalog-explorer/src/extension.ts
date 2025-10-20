/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	CatalogProviderRegistry,
	registerCatalogCommands,
	registerTreeViewProvider,
} from './catalog';
import { DefaultDatabricksCredentialProvider } from './credentials';
import { registerDatabricksProvider } from './catalogs/databricks';
import { registerMockProvider } from './catalogs/mock';
import { registerDbfsProvider } from './fs/dbfs';
import { setExtensionUri } from './resources';

export async function activate(context: vscode.ExtensionContext) {
	setExtensionUri(context);
	const registry = new CatalogProviderRegistry();

	if (context.extensionMode !== vscode.ExtensionMode.Production) {
		context.subscriptions.push(registerMockProvider(registry));
	}
	context.subscriptions.push(
		registerDatabricksProvider(registry),
		await registerTreeViewProvider(context, registry),
		registerDbfsProvider(
			new DefaultDatabricksCredentialProvider(context.secrets),
		),
	);
	registerCatalogCommands(context, registry);
}

export function deactivate() {}
