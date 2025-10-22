/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
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
import { registerSnowflakeProvider } from './catalogs/snowflake';
import { setExtensionUri } from './resources';

export async function activate(context: vscode.ExtensionContext) {
	// Check if the extension is enabled via configuration
	const config = vscode.workspace.getConfiguration('positronCatalogExplorer');
	const isEnabled = config.get<boolean>('enabled', true);
	const viewTestCatalog = config.get<boolean>('viewTestCatalog', false);

	// If the extension is disabled, return early without activating
	if (!isEnabled) {
		console.log('Catalog Explorer extension is disabled via configuration');
		return;
	}

	setExtensionUri(context);
	const registry = new CatalogProviderRegistry();

	if (viewTestCatalog) {
		context.subscriptions.push(registerMockProvider(registry));
	}
	context.subscriptions.push(
		registerDatabricksProvider(registry),
		registerSnowflakeProvider(registry),
		await registerTreeViewProvider(context, registry),
		registerDbfsProvider(
			new DefaultDatabricksCredentialProvider(context.secrets),
		),
	);
	registerCatalogCommands(context, registry);
}

export function deactivate() { }
