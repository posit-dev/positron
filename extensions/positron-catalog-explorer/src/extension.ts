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

async function initializeCatalogExplorer(context: vscode.ExtensionContext): Promise<void> {
	if (catalogExplorerEnabled) {
		return;
	}

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
	traceInfo('Catalog Explorer extension initialized');
}

export async function activate(context: vscode.ExtensionContext) {
	initializeLogging();
	traceInfo('Catalog Explorer extension activating');

	// Check if the extension is enabled via configuration
	const config = vscode.workspace.getConfiguration('catalogExplorer');
	const isEnabled = config.get<boolean>('enabled', true);

	// If the extension is disabled, set up a listener to initialize when enabled
	if (!isEnabled) {
		traceWarn('Catalog Explorer extension is disabled via configuration');
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(async (e) => {
				if (e.affectsConfiguration('catalogExplorer.enabled')) {
					const newConfig = vscode.workspace.getConfiguration('catalogExplorer');
					const newEnabled = newConfig.get<boolean>('enabled', false);
					if (newEnabled && !catalogExplorerEnabled) {
						traceInfo('Catalog Explorer enabled via configuration change');
						await initializeCatalogExplorer(context);
					}
				}
			})
		);
		return;
	}

	await initializeCatalogExplorer(context);
}

export function deactivate() { }
