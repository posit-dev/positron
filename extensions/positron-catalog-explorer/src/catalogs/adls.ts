/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	CatalogNode,
	CatalogProvider,
	CatalogProviderRegistration,
	CatalogProviderRegistry,
} from '../catalog';

const registration: CatalogProviderRegistration = {
	label: 'Azure Data Lake Storage',
	detail: 'Explore tables and files in Azure Data Lake Storage',
	iconPath: new vscode.ThemeIcon('azure'),
	addProvider: registerAzureCatalog,
	listProviders: getAzureCatalogs,
};

export function registerAzureProvider(
	registry: CatalogProviderRegistry,
): vscode.Disposable {
	// TODO: Need some way to signal to the registry that new providers
	// are available via vscode.authentication.onDidChangeSessions.
	return registry.register(registration);
}

/**
 * Register an Azure catalog provider for a Microsoft account using the built-in
 * authentication provider.
 */
async function registerAzureCatalog(
	_context: vscode.ExtensionContext,
): Promise<CatalogProvider | undefined> {
	const session = await vscode.authentication.getSession(
		'microsoft',
		['https://storage.azure.com/.default'],
		{
			createIfNone: true,
			clearSessionPreference: true,
		},
	);
	return new AzureCatalogProvider(session);
}

/**
 * Get a provider for all Azure accounts for which we have credentials.
 */
async function getAzureCatalogs(
	_context: vscode.ExtensionContext,
): Promise<CatalogProvider[]> {
	// TODO: Support blocklisting Microsoft accounts when dismissing
	// providers in the UI.
	const accounts = await vscode.authentication.getAccounts('microsoft');
	const sessions = await Promise.all(
		accounts.map(async (account) => {
			return await vscode.authentication.getSession(
				'microsoft',
				['https://storage.azure.com/.default'],
				{
					account: account,
					silent: true,
				},
			);
		}),
	);
	return sessions
		.filter((s) => s !== undefined)
		.map((s) => new AzureCatalogProvider(s));
}

/**
 * A provider for Azure Data Lake Storage.
 */
class AzureCatalogProvider implements CatalogProvider {
	private emitter = new vscode.EventEmitter<void>();
	public readonly id: string;

	constructor(private session: vscode.AuthenticationSession) {
		this.id = `azure:${session.account.id}`;
	}

	dispose() {
		// Clean up resources
		this.emitter.dispose();
	}

	onDidChange = this.emitter.event;

	refresh() {
		this.emitter.fire();
	}

	getTreeItem(): vscode.TreeItem {
		const item = new vscode.TreeItem(
			registration.label,
			vscode.TreeItemCollapsibleState.Expanded,
		);
		item.iconPath = registration.iconPath;
		item.tooltip = registration.label;
		item.description = this.session.account.label;
		item.contextValue = 'provider';
		return item;
	}

	getDetails(_node: CatalogNode): Promise<string | undefined> {
		return Promise.resolve(undefined);
	}

	getChildren(_node?: CatalogNode): Promise<CatalogNode[]> {
		return Promise.resolve([]);
	}
}
