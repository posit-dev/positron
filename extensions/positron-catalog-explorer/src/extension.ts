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
import { initializeLogging, traceInfo, traceWarn } from './logging';

let catalogExplorerEnabled = false;

/**
 * Initialize the catalog explorer with all providers and commands.
 */
async function initializeCatalogExplorer(context: vscode.ExtensionContext): Promise<void> {
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

	catalogExplorerEnabled = true;
	traceInfo('Catalog Explorer initialized successfully');
}

export async function activate(context: vscode.ExtensionContext) {
	initializeLogging();
	traceInfo('Catalog Explorer extension initializing');

	// Check if the extension is enabled via configuration
	const config = vscode.workspace.getConfiguration('catalogExplorer');
	const isEnabled = config.get<boolean>('enabled', true);

	if (isEnabled) {
		await initializeCatalogExplorer(context);
	} else {
		traceWarn('Catalog Explorer extension is disabled via configuration');

		// Listen for configuration changes so we can enable without reloading
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(async (e) => {
				if (e.affectsConfiguration('catalogExplorer.enabled')) {
					const enabled = vscode.workspace
						.getConfiguration('catalogExplorer')
						.get<boolean>('enabled', true);
					if (enabled && !catalogExplorerEnabled) {
						traceInfo('Catalog Explorer enabled via configuration change');
						await initializeCatalogExplorer(context);
					}
				}
			})
		);
	}
}

export function deactivate() { }
