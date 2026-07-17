/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
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
import { initializeLogging, traceInfo } from './logging';

/**
 * Activate the Catalog Explorer extension.
 *
 * Activation is driven on demand by the declarative activation events in
 * package.json (the `catalog-explorer` view and the palette commands), all of
 * which are gated on `config.catalogExplorer.enabled`. As a result the
 * extension - and its module graph - is only loaded once the feature is
 * actually enabled and used, rather than on every Positron startup.
 */
export async function activate(context: vscode.ExtensionContext) {
	initializeLogging();
	traceInfo('Catalog Explorer extension activating');

	const config = vscode.workspace.getConfiguration('catalogExplorer');
	const viewTestCatalog = config.get<boolean>('viewTestCatalog', false);

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

	traceInfo('Catalog Explorer extension initialized');
}

export function deactivate() { }
