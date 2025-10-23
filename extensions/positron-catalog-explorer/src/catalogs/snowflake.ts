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
import { getPositronAPI } from '../positron';

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
	// For the browser authentication flow, we create a new
	// connection each time rather than listing existing ones.
	// TODO: Maintain Snowflake sessions and list or regenerate them.
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
				return await this.listDatabases();
			} else if (node.type === 'catalog') {
				return await this.listSchemas(node.path);
			} else if (node.type === 'schema') {
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
	 * Generate code for accessing a Snowflake resource in the specified language.
	 *
	 * @param languageId The language to generate code for (e.g., 'python', 'r')
	 * @param node The catalog node to generate code for
	 * @returns Generated code as a string, or undefined if not supported
	 */
	async getCode(
		languageId: string,
		node: CatalogNode,
	): Promise<string | undefined> {

		const code = await generateCode(languageId, node, this.accountName);
		return code.code;
	}

	/**
	 * Open a Snowflake resource in an active Positron session
	 *
	 * @param node The catalog node to open in a session
	 */
	async openInSession(node: CatalogNode): Promise<void> {
		const positron = getPositronAPI();
		if (!positron) {
			return;
		}

		const session = await positron.runtime.getForegroundSession();
		if (!session) {
			return;
		}

		// Get the code to execute
		const { code } = await generateCode(
			session.runtimeMetadata.languageId,
			node,
			this.accountName
		);

		// Skip dependency checking
		session.execute(
			code,
			session.runtimeMetadata.languageId,
			positron.RuntimeCodeExecutionMode.Interactive,
			positron.RuntimeErrorBehavior.Continue,
		);
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

/**
 * Generate code for accessing a Snowflake resource based on the node type and language
 *
 * @param languageId Language identifier (python, r)
 * @param node The catalog node to generate code for
 * @param accountName The Snowflake account name
 * @returns Generated code and required dependencies
 */
async function generateCode(
	languageId: string,
	node: CatalogNode,
	accountName: string,

): Promise<{ code: string }> {
	const username = await vscode.window.showInputBox({
		prompt: 'Enter your Snowflake username',
		placeHolder: 'your-username@example.com'
	});

	if (!username) {
		throw new Error('Username is required for code generation');
	}

	// Extract database, schema, and table names from the path
	const pathParts = node.path.split('.');
	const tableName = pathParts.pop() || '';
	const schemaName = pathParts.pop() || '';
	const databaseName = pathParts.pop() || '';

	switch (languageId) {
		case 'python':
			return getPythonCodeForSnowflakeTable(accountName, databaseName, schemaName, tableName, username);
		case 'r':
			return getRCodeForSnowflakeTable(accountName, databaseName, schemaName, tableName);
		default:
			throw new Error(`Code generation for language '${languageId}' is not supported for Snowflake`);
	}
}

/**
 * Generate Python code for accessing a Snowflake table
 *
 * @param accountName The Snowflake account name
 * @param database The database name
 * @param schema The schema name
 * @param table The table name
 * @returns Generated code and required dependencies
 */
function getPythonCodeForSnowflakeTable(
	accountName: string,
	username: string,
	database?: string,
	schema?: string,
	table?: string
): { code: string; dependencies: string[] } {
	const dependencies = ['snowflake-connector-python', 'pandas'];

	let code = `# pip install ${dependencies.join(' ')}\n`;

	if (database && schema && table) {
		code += `# For ${accountName}.${database}.${schema}.${table}\n`;
	} else {
		code += `# For ${accountName}\n`;
	}

	code += `
import snowflake.connector as sc

conn_params = {
	'account': '${accountName}',
	'user': '${username}',
	'authenticator': 'externalbrowser',
`;

	// add database if provided
	if (database) {
		code += `	'database': '${database}',`;
	}

	// add schema if provided
	if (schema) {
		code += `\n	'schema': '${schema}'`;
	}

	// complete the connection parameters dict and establish connection
	code += `
}

# Establish the connection
conn = sc.connect(**conn_params)
cursor = conn.cursor()
`;
	// add query to fetch data from the specified table or default info
	if (table) {
		code += `query = "SELECT * FROM ${table} LIMIT 10"`;
	} else {
		code += `query = "SELECT CURRENT_VERSION(), CURRENT_USER(), CURRENT_ROLE()"`;
	}

	// execute the query
	code += `
cursor.execute(query)

# Fetch and display results
results = cursor.fetchall()
for row in results:
	print(row)

cursor.close()
`;

	return { code, dependencies };
}

/**
 * Generate R code for accessing a Snowflake table
 *
 * @param accountName The Snowflake account name
 * @param database The database name
 * @param schema The schema name
 * @param table The table name
 * @returns Generated code and required dependencies
 */
function getRCodeForSnowflakeTable(
	accountName: string,
	database: string,
	schema: string,
	table: string
): { code: string; dependencies: string[] } {
	const dependencies = ['DBI', 'odbc'];

	// This is just a placeholder structure - the actual R code will be implemented by the user
	const code = `# R code for Snowflake table access will go here
# For ${accountName}.${database}.${schema}.${table} `;

	return { code, dependencies };
}
