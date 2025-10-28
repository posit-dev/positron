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
	label: 'Snowflake',
	detail: 'Explore tables and stages in a Snowflake account',
	addProvider: registerSnowflakeCatalog,
	listProviders: getSnowflakeCatalogs,
};

export function registerSnowflakeProvider(
	registry: CatalogProviderRegistry,
): vscode.Disposable {
	vscode.authentication.onDidChangeSessions((e) => {
		if (e.provider.id === 'snowflake') {
		}
	});
	return registry.register(registration);
}

/**
 * Register a Snowflake catalog provider using the well-known authentication
 * provider.
 */
async function registerSnowflakeCatalog(
	_context: vscode.ExtensionContext,
): Promise<CatalogProvider | undefined> {
	try {
		// Unfortunately, authentication.getSession() currently hangs
		// for ~5s when no Snowflake authentication provider is
		// registered. In order to make this less confusing for users,
		// show a "progress" notification when this hang occurs.
		const session = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Checking for existing Snowflake OAuth2 sessions...',
			},
			() => {
				return vscode.authentication.getSession('snowflake', [], {
					createIfNone: true,
					clearSessionPreference: true,
				});
			},
		);
		return new SnowflakeCatalogProvider(session);
	} catch (_error) {
		vscode.window.showErrorMessage('No Snowflake OAuth2 credentials found.');
		return undefined;
	}
}

/**
 * Get a provider for all Snowflake accounts for which we have credentials.
 */
async function getSnowflakeCatalogs(
	_context: vscode.ExtensionContext,
): Promise<CatalogProvider[]> {
	let accounts;
	try {
		accounts = await vscode.authentication.getAccounts('snowflake');
	} catch (_error) {
		return Promise.resolve([]);
	}
	const sessions = await Promise.all(
		accounts.map(async (account) => {
			return await vscode.authentication.getSession('snowflake', [], {
				account: account,
				silent: true,
			});
		}),
	);
	return sessions
		.filter((s) => s !== undefined)
		.map((s) => new SnowflakeCatalogProvider(s));
}

/**
 * A provider for a Snowflake account.
 */
class SnowflakeCatalogProvider implements CatalogProvider {
	private emitter = new vscode.EventEmitter<void>();
	public readonly id: string;

	constructor(private session: vscode.AuthenticationSession) {
		this.id = `snowflake:${session.account.id}`;
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
