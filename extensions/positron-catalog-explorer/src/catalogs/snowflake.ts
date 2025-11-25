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
import { traceError, traceInfo, traceLog } from '../logging';
import { getSnowflakeConnectionOptions, SnowflakeConnectionOptions } from '../credentials';
import { l10n } from 'vscode';

export type SnowflakeLogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

export const registration: CatalogProviderRegistration = {
	label: l10n.t('Snowflake'),
	detail: l10n.t('Explore tables and stages in a Snowflake account'),
	addProvider: registerSnowflakeCatalog,
	removeProvider: async (
		context: vscode.ExtensionContext,
		provider: CatalogProvider,
	): Promise<void> => {
		let connectionName: string | undefined;

		if (provider.id && provider.id.startsWith('snowflake:')) {
			connectionName = provider.id.substring('snowflake:'.length);
		}
		if (!connectionName) {
			traceLog('Could not determine name for provider being removed');
			return;
		}

		// Remove from recent connections list so it doesn't reappear on reload
		const priorConns = context.globalState.get<string[]>(STATE_KEY_SNOWFLAKE_CONNECTIONS);
		if (priorConns && priorConns.includes(connectionName)) {
			const updatedRecent = priorConns.filter(account => account !== connectionName);
			await context.globalState.update(STATE_KEY_SNOWFLAKE_CONNECTIONS, updatedRecent);
		}
		// We don't have any stored credentials to clear since we use connections.toml
		// Just dispose the provider, which will close the connection if needed
		provider.dispose();
		traceLog(`Successfully removed Snowflake account: ${connectionName}`);
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
	context: vscode.ExtensionContext,
	connOptions?: string | any,
	connName?: string
): Promise<CatalogProvider | undefined> {
	// Load all connections from connections.toml
	const connections = await getSnowflakeConnectionOptions();

	// User is not re-authenticating an existing connection, prompt for one
	if (!connName) {
		let items: vscode.QuickPickItem[] = [];

		if (connections && Object.keys(connections).length > 0) {
			// If we found connections, add them to the quick pick
			const connectionNames = Object.keys(connections);
			items = connectionNames.map(name => ({
				label: name,
				description: l10n.t(`Connection from account (${connections[name].account || 'No account specified'})`),
			}));
		} else {
			// If no connections found, offer help options
			items = [
				{
					label: l10n.t('Update path in settings'),
					description: l10n.t('Create a connections.toml file in ~/.snowflake/ or set a custom path in settings.'),
					detail: l10n.t('Configure the path to your Snowflake connections.toml file')
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

		if (selection.label === l10n.t('Update path in settings')) {
			// Open settings UI focused on the connections.toml path setting
			await vscode.commands.executeCommand('workbench.action.openSettings', 'catalogExplorer.snowflakeConnections');
			return undefined;
		} else {
			// User selected a connection profile
			connName = selection.label;
		}
	}

	// user canceled
	if (!connName) {
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
	if (!connOptions && connections && connName) {
		connOptions = connections[connName];
	}

	// Start with base connection options
	const connectionOptions: snowflake.ConnectionOptions = {
		account: connOptions.account,
		authenticator: connOptions?.authenticator || 'externalbrowser',
	};

	// Apply any additional options from connection profile
	if (connOptions) {
		Object.entries(connOptions).forEach(([key, value]) => {
			if (value === undefined || value === null) {
				return;
			}
			// Special case: 'user' field should be mapped to 'username' in the Snowflake SDK
			if (key === 'user') {
				connectionOptions.username = value as string;
			} else if (key !== 'account' && key !== 'authenticator') {
				// For all other fields (except those already set), copy them directly
				(connectionOptions as any)[key] = value;
			}
		});
	}

	const connection = snowflake.createConnection(connectionOptions);

	return await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: l10n.t(`Authenticating to Snowflake via ${connOptions.authenticator}... (will timeout after 30s)`),
		},
		async () => {
			const AUTH_TIMEOUT_MS = 30000;

			try {
				await Promise.race([
					// Connection promise
					new Promise<void>((resolve, reject) => {
						connection.connectAsync((err) => err ? reject(err) : resolve());
					}),
					// Timeout promise
					new Promise<void>((_, reject) => {
						setTimeout(() => reject(new Error('Authentication timed out after 30 seconds')), AUTH_TIMEOUT_MS);
					})
				]);

				// Save in global state to track registered providers
				const registered = context.globalState.get<string[]>(STATE_KEY_SNOWFLAKE_CONNECTIONS);
				if (registered && registered.includes(connName!)) {
					traceLog(`Snowflake connection ${connName} is already registered.`);
				} else {
					const next: Set<string> = registered ? new Set(registered) : new Set();
					next.add(connName!);
					await context.globalState.update(STATE_KEY_SNOWFLAKE_CONNECTIONS, Array.from(next));
				}
				return new SnowflakeCatalogProvider(connection, connName!, connOptions);
			} catch (authError) {
				try {
					connection.destroy((err) => { if (err) { traceError('Error during connection cleanup:', err); } });
				} catch {
					// Silently ignore cleanup errors - they're less important than the main error
				}
				throw authError;
			}
		},
	);
}


/**
 * Get a provider for all Snowflake connections defined in connections.toml.
 *
 * Note: For the browser authentication flow, we don't automatically maintain active sessions.
 * Users will need to re-authenticate when they restart VS Code or the extension is reloaded.
 */
export async function getSnowflakeCatalogs(
	context: vscode.ExtensionContext
): Promise<CatalogProvider[]> {
	const providers: CatalogProvider[] = [];
	const priorConns = context.globalState.get<string[]>(STATE_KEY_SNOWFLAKE_CONNECTIONS) || [];
	traceInfo(`Registered Snowflake connections: ${priorConns.join(', ')}`);

	// Get all connections from connections.toml
	const connections = await getSnowflakeConnectionOptions();
	traceInfo(`Found Snowflake connections: ${connections ? Object.keys(connections).join(', ') : 'none'}`);
	if (!connections) {
		return providers;
	}

	try {
		// Only create providers for registered accounts, using connection information from TOML
		for (const connectionName of Object.keys(connections)) {
			if (priorConns.includes(connectionName)) {
				// Create a provider with info from connections.toml
				const provider: CatalogProvider = {
					id: `snowflake:${connectionName}`,
					getTreeItem: () => {
						const item = new vscode.TreeItem(registration.label);
						item.iconPath = registration.iconPath;
						item.description = `${connectionName} (Click to authenticate)`;
						const connInfo = connections[connectionName];

						item.tooltip = getTooltipInfo(connectionName, connInfo);

						item.command = {
							title: 'Authenticate',
							// This will use the addProvider method with our registration and connection info
							// which will then call our registerSnowflakeCatalog function with the full connection data
							command: 'posit.catalog-explorer.addCatalogProvider',
							arguments: [registration, connInfo, connectionName],
							tooltip: 'Click to authenticate with this Snowflake connection',
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
 * A provider for a Snowflake catalog.
 */
class SnowflakeCatalogProvider implements CatalogProvider {
	private emitter = new vscode.EventEmitter<void>();
	public readonly id: string;
	public readonly connName: string;
	public readonly connOptions: SnowflakeConnectionOptions;

	constructor(
		public connection: snowflake.Connection,
		connName: string,
		connOptions: SnowflakeConnectionOptions,
	) {
		this.connName = connName;
		this.id = `snowflake:${this.connName}`;
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
		item.tooltip = getTooltipInfo(this.connName, this.connOptions);
		item.description = this.connName;
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

		const code = await generateCode(languageId, node, this.connName);
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
			this.connName
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
	 * List all databases in the Snowflake catalog
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
 * @param connName The Snowflake connections name
 * @returns Generated code and required dependencies
 */
async function generateCode(
	languageId: string,
	catalogNode: CatalogNode,
	connName: string,
): Promise<{ code: string } | undefined> {
	const connections = await getSnowflakeConnectionOptions();
	if (!connections) {
		return undefined;
	}
	const connectionProfile = connections[connName];

	// Extract path parts and connection info in a more concise way
	const [tableName, pathSchema, pathDatabase] = catalogNode.path.split('.').reverse();

	// Use path values first, fall back to connection profile values if path values are empty
	const databaseName = pathDatabase || connectionProfile?.database;
	const schemaName = pathSchema || connectionProfile?.schema;

	// Get initial values from connection profile
	let warehouse = connectionProfile?.warehouse;

	// If we don't have a warehouse from the connection profile, prompt for it
	// Also make sure that we don't have a placeholder value
	if (!warehouse || warehouse === '<none selected>') {
		warehouse = await vscode.window.showInputBox({
			prompt: l10n.t('Enter your warehouse name'),
			placeHolder: 'my-warehouse'
		});
		if (!warehouse) {
			return; // User canceled
		}
	}

	switch (languageId) {
		case 'python':
			return await getPythonCodeForSnowflakeTable(
				connName,
				warehouse,
				databaseName,
				schemaName,
				tableName,
				connectionProfile
			);
		case 'r':
			return await getRCodeForSnowflakeTable(
				connectionProfile.account,
				warehouse,
				databaseName,
				schemaName,
				tableName
			);
		default:
			throw new Error(`Code generation for language '${languageId}' is not supported for Snowflake`);
	}
}

/**
 * Generate Python code for accessing a Snowflake table
 *
 * @param connName The Snowflake connection name in connections.toml
 * @param warehouse The warehouse name
 * @param database The database name
 * @param schema The schema name
 * @param table The table name
 * @param connOptions Optional connections object
 * @returns Generated code and required dependencies
 */
async function getPythonCodeForSnowflakeTable(
	connName: string,
	warehouse: string,
	database?: string,
	schema?: string,
	table?: string,
	connOptions?: any
): Promise<{ code: string; dependencies: string[] }> {
	const dependencies = ['"snowflake-connector-python[secure-local-storage, pandas]"', 'pandas'];
	const absoluteTablePath = [database, schema, table].filter(part => part).join('.');
	const label = absoluteTablePath ? `For ${absoluteTablePath}` : `For ${connName}`;

	// Prepare SQL query based on whether a table was provided
	const query = absoluteTablePath
		? `SELECT * FROM ${absoluteTablePath} LIMIT 10`
		: `SELECT CURRENT_VERSION(), CURRENT_USER(), CURRENT_ROLE()`;

	// Use a single template literal for the entire Python code
	const code = `# pip install ${dependencies.join(' ')}
# ${label}

import snowflake.connector

with snowflake.connector.connect(connection_name="${connName}") as conn:
\twith conn.cursor() as cursor:
${connOptions?.warehouse ? '' : `\t\tcursor.execute("USE WAREHOUSE ${warehouse}")\n`}
\t\tquery = "${query}"
\t\t# Execute the query
\t\tcursor.execute(query)
\t\t# Fetch and display results
\t\tresults = cursor.fetch_pandas_all()
\t\tfor colname in results:
\t\t\tprint(colname)
`;

	return { code, dependencies };
}

/**
 * Generate R code for accessing a Snowflake table
 *
 * @param account The Snowflake account identifier.
 * @param warehouse An optional warehouse.
 * @param database Optional database name
 * @param schema Optional schema name
 * @param table Optional table name
 * @returns Generated code and required dependencies
 */
async function getRCodeForSnowflakeTable(
	account: string,
	warehouse?: string,
	database?: string,
	schema?: string,
	table?: string
): Promise<{ code: string; dependencies: string[] }> {
	const dependencies = ['odbc', 'dplyr'];
	const absoluteTablePath = [database, schema, table].filter(part => part).join('.');
	const varname = table?.replace('-', '_').toLowerCase();

	const code = `conn <- DBI::dbConnect(
	  odbc::snowflake(),
	  account = "${account}"${warehouse ? `,
	  warehouse = "${warehouse}"` : ''}
)
${table
			? `${varname} <- dplyr::tbl(conn, I("${absoluteTablePath}"))
${varname}`
			: `DBI::dbGetQuery(conn, "SELECT CURRENT_VERSION(), CURRENT_USER(), CURRENT_ROLE()")`}
`;

	return { code, dependencies };
}

function getTooltipInfo(connectionName: string, connInfo: any): string {
	let tooltip = `${connectionName}`;

	if (connInfo) {
		if (connInfo.user) { tooltip += `\nUser: ${connInfo.user}`; }
		if (connInfo.role) { tooltip += `\nRole: ${connInfo.role}`; }
		if (connInfo.account) { tooltip += `\nAccount: ${connInfo.account}`; }
	}

	return tooltip;
}


const STATE_KEY_SNOWFLAKE_CONNECTIONS = 'snowflakeConnections';
