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
import { traceError, traceLog } from '../logging';
import { getSnowflakeConnectionOptions, SnowflakeConnectionOptions } from '../credentials';

export type SnowflakeLogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

export const registration: CatalogProviderRegistration = {
	label: 'Snowflake',
	detail: 'Explore tables and stages in a Snowflake account',
	addProvider: registerSnowflakeCatalog,
	removeProvider: async (
		context: vscode.ExtensionContext,
		provider: CatalogProvider,
	): Promise<void> => {
		let accountName: string | undefined;

		if (provider instanceof SnowflakeCatalogProvider) {
			// Authenticated provider
			accountName = provider.accountName;
		} else {
			// For placeholder providers
			if (provider.id && provider.id.startsWith('snowflake:')) {
				accountName = provider.id.substring('snowflake:'.length);
			}
		}
		if (!accountName) {
			traceLog('Could not determine account name for provider being removed');
			return;
		}

		// Remove from recent accounts list so it doesn't reappear on reload
		const recentAccounts = context.globalState.get<string[]>(STATE_KEY_SNOWFLAKE_CONNECTIONS);
		if (recentAccounts && recentAccounts.includes(accountName)) {
			const updatedRecent = recentAccounts.filter(account => account !== accountName);
			await context.globalState.update(STATE_KEY_SNOWFLAKE_CONNECTIONS, updatedRecent);
		}
		// We don't have any stored credentials to clear since we use browser SSO
		// Just dispose the provider, which will close the connection if needed
		provider.dispose();
		traceLog(`Successfully removed Snowflake account: ${accountName}`);
	},
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
 * Register a Snowflake catalog provider using authentication details from connections.toml.
 */
export async function registerSnowflakeCatalog(
	_context: vscode.ExtensionContext,
	connOptions?: string | any,
): Promise<CatalogProvider | undefined> {
	let account = connOptions?.account;
	const connections = await getSnowflakeConnectionOptions();

	// User is not re-authenticating an existing account, prompt for account name
	if (!account) {
		let items: vscode.QuickPickItem[] = [];

		if (connections && Object.keys(connections).length > 0) {
			// If we found connections, add them to the quick pick
			const connectionNames = Object.keys(connections);
			items = connectionNames.map(name => ({
				label: name,
				description: `Connection from configuration (${connections[name].account || 'No account specified'})`
			}));
		} else {
			// If no connections found, offer help options
			items = [
				{
					label: 'No connections.toml file found',
					description: 'Configure where to look for connections.toml',
					detail: 'Create a connections.toml file in ~/.snowflake/ or set a custom path in settings.'
				}
			];
		}

		const selection = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select a connection profile',
			ignoreFocusOut: true
		});

		if (!selection) {
			return undefined; // User canceled
		}

		if (selection.label === 'Update path in settings') {
			// Open settings UI focused on the connections.toml path setting
			await vscode.commands.executeCommand('workbench.action.openSettings', 'catalogExplorer.snowflakeConnections');
			return undefined;
		} else {
			// User selected a connection profile
			account = selection.label;
		}
	}

	// still no account, user canceled
	if (!account) {
		return undefined;
	}

	// Place snowflake logs in users workspace folder if available
	const config = vscode.workspace.getConfiguration('catalogExplorer');
	const logLevelStr = config.get<string>('logLevel', 'INFO') as SnowflakeLogLevel;

	snowflake.configure({
		logLevel: logLevelStr,
		logFilePath: vscode.workspace.workspaceFolders
			? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined
	});

	// If we don't already have a connection profile from the input, try to get it from connections.toml
	if (!connOptions && connections && account) {
		connOptions = connections[account];
	}

	// Start with base connection options
	const connectionOptions: snowflake.ConnectionOptions = {
		account: account,
		authenticator: connOptions?.authenticator || 'externalbrowser',
	};

	// Apply any additional options from connection profile
	if (connOptions) {
		// Copy all fields from connection profile, handling special cases
		Object.entries(connOptions).forEach(([key, value]) => {
			if (value === undefined || value === null) {
				return;
			}

			// Special case: 'user' field should be mapped to 'username' in the Snowflake SDK
			if (key === 'user') {
				// Use type assertion to ensure TypeScript accepts this assignment
				connectionOptions.username = value as string;
			} else if (key !== 'account' && key !== 'authenticator') {
				// For all other fields (except those already set), copy them directly
				// Use type assertion for TypeScript
				(connectionOptions as any)[key] = value;
			}
		});
	}

	const connection = snowflake.createConnection(connectionOptions);

	return await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Authenticating to Snowflake via External Browser SSO... (will timeout after 15s)',
		},
		async () => {
			// Set up a simplified authentication with timeout
			const AUTH_TIMEOUT_MS = 15000;

			try {
				// Use a single Promise.race with cleaner syntax
				await Promise.race([
					// Connection promise
					new Promise<void>((resolve, reject) => {
						connection.connectAsync((err) => err ? reject(err) : resolve());
					}),
					// Timeout promise
					new Promise<void>((_, reject) => {
						setTimeout(() => reject(new Error('Authentication timed out after 15 seconds')), AUTH_TIMEOUT_MS);
					})
				]);

				// Save the account in global state to track registered providers
				const registered = _context.globalState.get<string[]>(STATE_KEY_SNOWFLAKE_CONNECTIONS);
				const next: Set<string> = registered ? new Set(registered) : new Set();
				next.add(account!);
				await _context.globalState.update(STATE_KEY_SNOWFLAKE_CONNECTIONS, Array.from(next));

				// Return the provider
				return new SnowflakeCatalogProvider(connection, account!, connOptions);
			} catch (authError) {
				// Clean up resources on authentication failure
				try {
					connection.destroy((err) => { if (err) { traceError('Error during connection cleanup:', err); } });
				} catch {
					// Silently ignore cleanup errors - they're less important than the main error
				}

				// Re-throw the original error
				throw authError;
			}
		},
	);
}


/**
 * Get a provider for all Snowflake accounts defined in connections.toml.
 *
 * Note: For the browser authentication flow, we don't automatically maintain active sessions.
 * Users will need to re-authenticate when they restart VS Code or the extension is reloaded.
 */
export async function getSnowflakeCatalogs(
	context: vscode.ExtensionContext
): Promise<CatalogProvider[]> {
	const providers: CatalogProvider[] = [];
	const registeredAccounts = context.globalState.get<string[]>(STATE_KEY_SNOWFLAKE_CONNECTIONS) || [];

	// Get all connections from connections.toml
	const connections = await getSnowflakeConnectionOptions();
	if (!connections) {
		return providers;
	}

	try {
		// Only create providers for registered accounts, using connection information from TOML
		for (const connectionName of Object.keys(connections)) {
			const accountName = connections[connectionName].account || connectionName;

			// Only create providers for registered accounts
			if (registeredAccounts.includes(connectionName) || registeredAccounts.includes(accountName)) {
				// Create a provider with info from connections.toml
				const provider: CatalogProvider = {
					id: `snowflake:${connectionName}`,
					getTreeItem: () => {
						const item = new vscode.TreeItem(registration.label);
						item.iconPath = registration.iconPath;
						item.description = connectionName;
						item.contextValue = `provider:snowflake:placeholder:${connectionName}`;

						const connInfo = connections[connectionName];

						item.tooltip = getTooltipInfo(connectionName, connInfo);

						item.command = {
							title: 'Authenticate',
							// This will use the addProvider method with our registration and connection info
							// which will then call our registerSnowflakeCatalog function with the full connection data
							command: 'posit.catalog-explorer.addCatalogProvider',
							arguments: [registration, connInfo],
							tooltip: 'Click to authenticate with this Snowflake account'
						};

						return item;
					},
					getDetails: () => Promise.resolve(undefined),
					getChildren: () => Promise.resolve([]),
					dispose: () => { }

				};

				providers.push(provider);
			}
		}
	} catch (error) {
		traceError('Error loading Snowflake connections:', error);
	}

	return providers;
}

/**
 * A provider for a Snowflake account.
 */
class SnowflakeCatalogProvider implements CatalogProvider {
	private emitter = new vscode.EventEmitter<void>();
	public readonly id: string;
	public readonly accountName: string;
	public readonly connOptions: SnowflakeConnectionOptions;

	constructor(
		public connection: snowflake.Connection,
		accountName: string,
		connOptions: SnowflakeConnectionOptions,
	) {
		this.accountName = accountName;
		this.id = `snowflake:${this.accountName}`;
		this.connOptions = connOptions;
	}

	dispose() {
		// Clean up resources
		this.emitter.dispose();

		// Destroy the Snowflake connection
		this.connection.destroy((err) => {
			if (err) {
				traceError('Error destroying Snowflake connection:', err);
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
		item.tooltip = getTooltipInfo(this.accountName, this.connOptions);
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
			traceError('Error getting Snowflake children:', error);
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
		return code?.code;
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
		const code = await generateCode(
			session.runtimeMetadata.languageId,
			node,
			this.accountName
		);

		if (!code) {
			return;
		}

		// Skip dependency checking
		session.execute(
			code.code,
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
			traceError('Error listing databases:', error);
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
			traceError(
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
			traceError(`Error listing tables in schema ${schemaPath}:`, error);
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
 * @param catalogNode The catalog node to generate code for
 * @param accountName The Snowflake account name
 * @returns Generated code and required dependencies
 */
async function generateCode(
	languageId: string,
	catalogNode: CatalogNode,
	accountName: string,
): Promise<{ code: string } | undefined> {
	// Get provider and connection information
	// Try to get connection info from connections.toml
	const connections = await getSnowflakeConnectionOptions();
	const connectionProfile = connections && connections[accountName];

	// Use connection profile info if available, otherwise prompt for username and warehouse
	let username: string | undefined;
	let warehouse: string | undefined;
	let databaseName: string | undefined;
	let schemaName: string | undefined;

	// Extract database, schema, and table names from the path
	const pathParts = catalogNode.path.split('.');
	const tableName = pathParts.pop() || '';
	const pathSchema = pathParts.pop() || '';
	const pathDatabase = pathParts.pop() || '';

	// First assign schema and database from the path
	schemaName = pathSchema;
	databaseName = pathDatabase;

	// Then override with connection profile values if available and if path values are empty
	if (connectionProfile) {
		username = connectionProfile.user;
		warehouse = connectionProfile.warehouse;

		// Only use connection profile values if path values are empty
		if (!databaseName && connectionProfile.database) {
			databaseName = connectionProfile.database;
		}
		if (!schemaName && connectionProfile.schema) {
			schemaName = connectionProfile.schema;
		}
	}

	// If we don't have a username from the connection profile, prompt for it
	if (!username) {
		username = await vscode.window.showInputBox({
			prompt: 'Enter your Snowflake username',
			placeHolder: 'your-username@example.com'
		});

		if (!username) {
			return; // User canceled
		}
	}

	// If we don't have a warehouse from the connection profile, prompt for it
	if (!warehouse) {
		warehouse = await vscode.window.showInputBox({
			prompt: 'Enter your warehouse name',
			placeHolder: 'my-warehouse'
		});
		if (!warehouse) {
			return; // User canceled
		}
	}

	switch (languageId) {
		case 'python':
			return await getPythonCodeForSnowflakeTable(
				accountName,
				username,
				warehouse,
				databaseName,
				schemaName,
				tableName,
				connections
			);
		case 'r':
			return await getRCodeForSnowflakeTable(
				accountName,
				username,
				warehouse,
				databaseName,
				schemaName,
				tableName,
				connections
			);
		default:
			throw new Error(`Code generation for language '${languageId}' is not supported for Snowflake`);
	}
}

/**
 * Generate Python code for accessing a Snowflake table
 *
 * @param accountName The Snowflake account name
 * @param username The Snowflake username
 * @param warehouse The warehouse name
 * @param database The database name
 * @param schema The schema name
 * @param table The table name
 * @param connections Optional connections object
 * @returns Generated code and required dependencies
 */
async function getPythonCodeForSnowflakeTable(
	accountName: string,
	username: string,
	warehouse: string,
	database?: string,
	schema?: string,
	table?: string,
	connections?: any
): Promise<{ code: string; dependencies: string[] }> {
	const dependencies = ['snowflake-connector-python[secure-local-storage]', 'pandas'];
	// Determine if we should use password authentication
	const usePassword = connections && connections[accountName]?.password ? true : false;

	let code = `# pip install ${dependencies.join(' ')}\n`;

	if (database && schema && table) {
		code += `# For ${accountName}.${database}.${schema}.${table}\n`;
	} else {
		code += `# For ${accountName}\n`;
	}

	code += `
import snowflake.connector as sc
${usePassword ? 'import os  # For environment variables\n' : ''}
conn_params = {
	'account': '${accountName}',
	'user': '${username}',
`;

	if (usePassword) {
		code += `	# Password should be stored securely. For example, use environment variables:
	'password': os.environ.get('SNOWFLAKE_PASSWORD'),
`;
	} else {
		code += `	'authenticator': 'externalbrowser',
`;
	}

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
cursor.execute("USE WAREHOUSE ${warehouse}")
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
 * @param username The Snowflake username
 * @param warehouse The warehouse name
 * @param database Optional database name
 * @param schema Optional schema name
 * @param table Optional table name
 * @param connections Optional connections object from getSnowflakeConnectionOptions
 * @returns Generated code and required dependencies
 */
async function getRCodeForSnowflakeTable(
	accountName: string,
	username: string,
	warehouse: string,
	database?: string,
	schema?: string,
	table?: string,
	connections?: any
): Promise<{ code: string; dependencies: string[] }> {
	const dependencies = ['DBI', 'odbc'];

	// Determine if we should use password authentication
	const usePassword = connections && connections[accountName]?.password ? true : false;

	// Build a code template with the available parameters
	let code = `library(odbc)
library(DBI)

con <- dbConnect(
	odbc::odbc(),
	driver = "YOUR_DRIVER_NAME",  # Prior driver setup required
	server = "${accountName}.snowflakecomputing.com",
	uid = "${username}",`;

	if (usePassword) {
		code += `
	# Password should be stored securely in environment variables
	pwd = Sys.getenv("SNOWFLAKE_PASSWORD"),`; // pragma: allowlist secret
	} else {
		code += `
	# This setup assumes you're using SSO authentication
	authenticator = "externalbrowser",`;
	}

	code += `\n\twarehouse = "${warehouse}",`;

	// Add database if available
	if (database) {
		code += `,\n\tdatabase = "${database}"`;
	}

	// Add schema if available
	if (schema) {
		code += `,\n\tschema = "${schema}"`;
	}

	// Close the connection parameters
	code += `
)

# Query data`;

	// Add table-specific query if table is provided
	if (table) {
		code += `
df <- dbGetQuery(con, "SELECT * FROM ${table} LIMIT 10")`;
	} else {
		code += `
df <- dbGetQuery(con, "SELECT CURRENT_VERSION(), CURRENT_USER(), CURRENT_ROLE()")`;
	}

	// Add disconnect statement
	code += `

# Disconnect when done
dbDisconnect(con)`;

	return { code, dependencies };
}

function getTooltipInfo(connectionName: string, connInfo: any): string {
	let tooltip = `${connectionName}`;

	if (connInfo) {
		if (connInfo.role) { tooltip += `\nRole: ${connInfo.role}`; }
		if (connInfo.user) { tooltip += `\nUser: ${connInfo.user}`; }
		if (connInfo.warehouse) { tooltip += `\nWarehouse: ${connInfo.warehouse}`; }
		if (connInfo.database) { tooltip += `\nDatabase: ${connInfo.database}`; }
		if (connInfo.schema) { tooltip += `\nSchema: ${connInfo.schema}`; }
	}

	return tooltip;
}


const STATE_KEY_SNOWFLAKE_CONNECTIONS = 'snowflakeConnections';
