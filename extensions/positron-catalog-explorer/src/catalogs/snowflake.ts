/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as snowflake from 'snowflake-sdk';
import {
	CatalogNode,
	CatalogProvider,
	CatalogProviderRegistration,
	CatalogProviderRegistry,
} from '../catalog';
import { resourceUri } from '../resources';

const registration: CatalogProviderRegistration = {
	label: 'Snowflake',
	detail: 'Explore tables and stages in a Snowflake account',
	addProvider: registerSnowflakeCatalog,
	listProviders: getSnowflakeCatalogs,
};

export function registerSnowflakeProvider(
	registry: CatalogProviderRegistry,
): vscode.Disposable {
	registration.iconPath = {
		light: resourceUri('light', 'snowflake.png'),
		dark: resourceUri('dark', 'snowflake.png'),
	};
	vscode.authentication.onDidChangeSessions((e) => {
		if (e.provider.id === 'snowflake') {
		}
	});
	return registry.register(registration);
}

/**
 * Register a Snowflake catalog provider using External Browser SSO authentication.
 */
async function registerSnowflakeCatalog(
	_context: vscode.ExtensionContext,
): Promise<CatalogProvider | undefined> {
	try {
		// Prompt user for Snowflake account identifier
		const account = await vscode.window.showInputBox({
			prompt: 'Enter your Snowflake account identifier',
			placeHolder: 'orgname-accountname',
		});

		if (!account) {
			return undefined;
		}

		const connection = snowflake.createConnection({
			account: account,
			authenticator: 'EXTERNALBROWSER',
		});


		return await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Authenticating to Snowflake via External Browser SSO...',
			},
			async () => {
				// Use promisified version of connect
				await new Promise<void>((resolve, reject) => {
					connection.connectAsync((err) => {
						if (err) {
							reject(err);
						} else {
							resolve();
						}
					});
				});

				// Return new provider with established connection
				return new SnowflakeCatalogProvider(connection, account);
			},
		);
	} catch (error) {
		vscode.window.showErrorMessage(
			`Snowflake authentication failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
}

/**
 * Get a provider for all Snowflake accounts for which we have connections.
 */
function getSnowflakeCatalogs(): Promise<CatalogProvider[]> {
	// For the browser authentication flow, we need to create a new
	// connection each time rather than listing existing ones.
	return Promise.resolve([]);
}

/**
 * A provider for a Snowflake account.
 */
class SnowflakeCatalogProvider implements CatalogProvider {
	private emitter = new vscode.EventEmitter<void>();
	public readonly id: string;
	private accountName: string;

	constructor(
		private connection: snowflake.Connection,
		accountName: string,
	) {
		this.accountName = accountName;
		this.id = `snowflake:${this.accountName}`;
	}

	dispose() {
		// Clean up resources
		this.emitter.dispose();

		// Destroy the Snowflake connection
		this.connection.destroy((err) => {
			if (err) {
				console.error('Error destroying Snowflake connection:', err);
			}
		});
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
		item.description = this.accountName;
		item.contextValue = 'provider';
		return item;
	}

	getDetails(_node: CatalogNode): Promise<string | undefined> {
		return Promise.resolve(undefined);
	}

	/**
	 * Get children nodes in the catalog tree.
	 * For Snowflake, this would typically be databases, schemas, tables, etc.
	 */
	async getChildren(node?: CatalogNode): Promise<CatalogNode[]> {
		try {
			if (!node) {
				// Top level - get databases
				return await this.listDatabases();
			} else if (node.type === 'catalog') {
				// Database level - get schemas
				return await this.listSchemas(node.path);
			} else if (node.type === 'schema') {
				// Schema level - get tables
				return await this.listTables(node.path);
			}

			// Default case - return empty array
			return [];
		} catch (error) {
			console.error('Error getting Snowflake children:', error);
			vscode.window.showErrorMessage(
				`Failed to retrieve Snowflake data: ${error instanceof Error ? error.message : String(error)}`,
			);
			return [];
		}
	}

	/**
	 * Execute a SQL query on the Snowflake connection and return the results
	 */
	private executeQuery<T>(sql: string): Promise<T[]> {
		return new Promise((resolve, reject) => {
			this.connection.execute({
				sqlText: sql,
				complete: function (err, _stmt, rows) {
					if (err) {
						reject(err);
					} else {
						resolve(rows as T[]);
					}
				},
			});
		});
	}

	/**
	 * List all databases in the Snowflake account
	 */
	private async listDatabases(): Promise<CatalogNode[]> {
		try {
			// Use SHOW DATABASES command which works without requiring a current database
			const sql = `SHOW DATABASES`;
			const databases = await this.executeQuery<{ name: string }>(sql);

			return databases.map((db) => {
				return new CatalogNode(db.name, 'catalog', this);
			});
		} catch (error) {
			console.error('Error listing databases:', error);
			vscode.window.showErrorMessage(
				`Failed to list Snowflake databases: ${error instanceof Error ? error.message : String(error)}`,
			);
			return [];
		}
	}

	/**
	 * List all schemas in the specified database
	 */
	private async listSchemas(databaseName: string): Promise<CatalogNode[]> {
		try {
			// Use SHOW SCHEMAS command which works without requiring warehouse resources
			const sql = `SHOW SCHEMAS IN DATABASE "${databaseName}"`;
			const schemas = await this.executeQuery<{ name: string }>(sql);

			return schemas.map((schema) => {
				return new CatalogNode(
					`${databaseName}.${schema.name}`,
					'schema',
					this,
				);
			});
		} catch (error) {
			console.error(
				`Error listing schemas in database ${databaseName}:`,
				error,
			);
			vscode.window.showErrorMessage(
				`Failed to list schemas in ${databaseName}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return [];
		}
	}

	/**
	 * List all tables in the specified schema
	 */
	private async listTables(schemaPath: string): Promise<CatalogNode[]> {
		try {
			const [databaseName, schemaName] = schemaPath.split('.');
			// Use SHOW TABLES command which works without requiring warehouse resources
			const sql = `SHOW TABLES IN SCHEMA "${databaseName}"."${schemaName}"`;
			const tables = await this.executeQuery<{ name: string }>(sql);

			return tables.map((table) => {
				return new CatalogNode(`${schemaPath}.${table.name}`, 'table', this);
			});
		} catch (error) {
			console.error(`Error listing tables in schema ${schemaPath}:`, error);
			vscode.window.showErrorMessage(
				`Failed to list tables in ${schemaPath}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return [];
		}
	}
}
