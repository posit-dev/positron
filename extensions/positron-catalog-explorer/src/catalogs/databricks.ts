/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import {
	CatalogNode,
	CatalogNodeType,
	CatalogProvider,
	CatalogProviderRegistration,
	CatalogProviderRegistry,
} from '../catalog';
import { UnityCatalogClient } from './unityCatalogClient';
import { DatabricksFilesClient, dbfsUri, dbfsVolumeUri } from '../fs/dbfs';
import { resourceUri } from '../resources';
import { DefaultDatabricksCredentialProvider } from '../credentials';
import { getPositronAPI } from '../positron';
import path from 'path';

const registration: CatalogProviderRegistration = {
	label: 'Databricks',
	detail: 'Explore tables, volumes, and files in the Unity Catalog',
	addProvider: registerDatabricksCatalog,
	removeProvider: async (
		context: vscode.ExtensionContext,
		provider: DatabricksCatalogProvider,
	): Promise<void> => {
		const workspaceUrl = provider.workspace;

		// Important: First check if the workspace exists in storage before deleting
		const registered = context.globalState.get<string[]>(STATE_KEY);
		if (!registered || !registered.includes(workspaceUrl)) {
			// If not in storage, could be a duplicate removal or already removed
			console.log(
				`Workspace ${workspaceUrl} not found in registered workspaces`,
			);

			// Still attempt to clean up any stray credentials that might exist
			const credProvider = new DefaultDatabricksCredentialProvider(
				context.secrets,
			);
			await credProvider.removeToken(workspaceUrl);
			return;
		}

		// Ensure the workspace is removed from storage and credentials are cleaned up
		await unregisterDatabricksCatalog(context, workspaceUrl);

		// Verify removal succeeded
		const updatedRegistered =
			context.globalState.get<string[]>(STATE_KEY) || [];
		if (updatedRegistered.includes(workspaceUrl)) {
			throw new Error(
				`Failed to remove workspace ${workspaceUrl} from storage`,
			);
		}
	},
	listProviders: getDatabricksCatalogs,
};

export function registerDatabricksProvider(
	registry: CatalogProviderRegistry,
): vscode.Disposable {
	// We have to do this lazily due to paths not being available until
	// after initialisation.
	registration.iconPath = {
		light: resourceUri('light', 'databricks.svg'),
		dark: resourceUri('dark', 'databricks.svg'),
	};
	return registry.register(registration);
}

/**
 * Register a Databricks catalog provider for the given workspace using a PAT
 * as a credential.
 */
async function registerDatabricksCatalog(
	context: vscode.ExtensionContext,
): Promise<CatalogProvider | undefined> {
	const workspace = await vscode.window.showInputBox({
		title: 'Databricks Workspace',
		// Users will likely be copy & pasting this value.
		ignoreFocusOut: true,
		validateInput: (value: string) => {
			if (value.startsWith('https://')) {
				return undefined;
			}
			return {
				message: `Workspace URLs must begin with "https://".`,
				severity: vscode.InputBoxValidationSeverity.Error,
			};
		},
	});
	if (!workspace) {
		return;
	}
	const token = await vscode.window.showInputBox({
		title: 'Personal Access Token',
		ignoreFocusOut: true,
		password: true,
		validateInput: (value: string) => {
			if (value.startsWith('dapi')) {
				return undefined;
			}
			return {
				message: `Unrecognized token format. Tokens should start with "dapi".`,
				severity: vscode.InputBoxValidationSeverity.Warning,
			};
		},
	});
	if (!token) {
		return;
	}
	const registered = context.globalState.get<string[]>(STATE_KEY);
	const next: Set<string> = registered ? new Set(registered) : new Set();
	next.add(workspace);
	await context.globalState.update(STATE_KEY, Array.from(next));
	await context.secrets.store(workspace, token);
	return new DatabricksCatalogProvider(workspace, token);
}

/**
 * Unregister a previously-registered Databricks catalog provider.
 * This removes both the registration from global state and all credentials.
 */
export async function unregisterDatabricksCatalog(
	context: vscode.ExtensionContext,
	workspace: string,
): Promise<void> {
	// Normalize workspace ID
	const normalizedWorkspace = workspace.startsWith('https://')
		? workspace
		: `https://${workspace}`;

	// Remove from registration list
	const registered = context.globalState.get<string[]>(STATE_KEY);
	const next: Set<string> = registered ? new Set(registered) : new Set();
	next.delete(workspace);
	next.delete(normalizedWorkspace);
	next.delete(normalizedWorkspace.replace('https://', ''));
	await context.globalState.update(STATE_KEY, Array.from(next));

	// Create credential provider to properly clear cache
	const credProvider = new DefaultDatabricksCredentialProvider(context.secrets);

	// Remove credentials using the proper method that also cleans the cache
	await credProvider.removeToken(workspace);
	await credProvider.removeToken(normalizedWorkspace);
}

/**
 * Get all registered Databricks catalogs for which we have credentials.
 */
async function getDatabricksCatalogs(
	context: vscode.ExtensionContext,
): Promise<CatalogProvider[]> {
	const registered = context.globalState.get<string[]>(STATE_KEY);
	if (!registered) {
		return [];
	}
	const creds = new DefaultDatabricksCredentialProvider(context.secrets);
	const providers = await Promise.all(
		registered.map(async (workspace) => {
			const token = await creds.getToken(workspace);
			if (!token) {
				return undefined;
			}
			return new DatabricksCatalogProvider(workspace, token);
		}),
	);
	return providers.filter((p) => p !== undefined);
}

/**
 * A provider for a Databricks Unity Catalog.
 */
export class DatabricksCatalogProvider implements CatalogProvider {
	private emitter = new vscode.EventEmitter<void>();
	private catalogClient: UnityCatalogClient;
	private fsClient: DatabricksFilesClient;
	public workspace: string;
	private warehousePath: string | undefined;
	public readonly id: string;

	constructor(
		workspace: string,
		private token: string,
	) {
		// Normalize workspace URL consistently - strip https:// prefix
		this.workspace = workspace.replace(/^https:\/\//, '');

		// Create a unique ID for this provider using the normalized workspace
		this.id = `databricks:${this.workspace}`;

		this.catalogClient = new UnityCatalogClient(
			`https://${this.workspace}`,
			token,
		);
		this.fsClient = new DatabricksFilesClient(
			`https://${this.workspace}`,
			token,
		);
	}

	dispose() {
		// Clean up resources
		this.emitter.dispose();

		// Clear references to potentially sensitive data
		this.token = '';
		this.warehousePath = undefined;
	}

	onDidChange = this.emitter.event;

	refresh() {
		this.warehousePath = undefined; // Escape hatch for resetting this.
		this.emitter.fire();
	}

	getTreeItem(): vscode.TreeItem {
		const item = new vscode.TreeItem(
			registration.label,
			vscode.TreeItemCollapsibleState.Expanded,
		);
		item.iconPath = registration.iconPath;
		item.tooltip = registration.label;
		item.description = this.workspace;
		item.contextValue = 'provider';
		return item;
	}

	getDetails(node?: CatalogNode): Promise<string | undefined> {
		if (!node) {
			return Promise.resolve(undefined);
		}
		if (node.type === 'catalog') {
			return Promise.resolve(`Catalog: ${node.path}`);
		}
		if (node.type === 'schema') {
			return Promise.resolve(`Schema: ${node.path}`);
		}
		return Promise.resolve(undefined);
	}

	async getChildren(node?: CatalogNode): Promise<CatalogNode[]> {
		if (!node) {
			const catalogs = await this.catalogClient.listCatalogs();
			return catalogs.map((c) => {
				return new CatalogNode(c.name, 'catalog', this);
			});
		}
		if (node.type === 'catalog') {
			const schemas = await this.catalogClient.listSchemas(node.path);
			return schemas.map((s) => {
				return new CatalogNode(`${node.path}.${s.name}`, 'schema', this);
			});
		}
		if (node.type === 'schema') {
			const fqn = node.path.split('.');
			const tables = await this.catalogClient.listTables(fqn[0], fqn[1]);
			const volumes = await this.catalogClient.listVolumes(fqn[0], fqn[1]);
			return [
				...tables.map((t) => {
					const path = `${node.path}.${t.name}`;
					return new CatalogNode(
						path,
						'table',
						this,
						databricksTableUri(
							this.workspace,
							t.catalog_name,
							t.schema_name,
							t.name,
							this.warehousePath,
						),
					);
				}),
				...volumes.map((t) => {
					return new CatalogNode(
						`${node.path}.${t.name}`,
						'volume',
						this,
						dbfsVolumeUri(
							this.workspace,
							t.catalog_name,
							t.schema_name,
							t.name,
						),
					);
				}),
			];
		}
		if (node.type === 'volume' && node.resourceUri) {
			const contents = await this.fsClient.listContents(node.resourceUri.path);
			return contents.map((e) => {
				return new CatalogNode(
					e.name,
					e.is_directory ? 'directory' : 'file',
					this,
					dbfsUri(this.workspace, e.path),
				);
			});
		}
		return [];
	}

	async getCode(
		languageId: string,
		node: CatalogNode,
	): Promise<string | undefined> {
		const uri = await this.uriWithWarehouse(node);
		if (!uri) {
			return;
		}
		const code = getCodeForUri(languageId, uri, node.type);
		return code.code;
	}

	async openInSession(node: CatalogNode): Promise<void> {
		const uri = await this.uriWithWarehouse(node);
		if (!uri) {
			return;
		}
		const positron = getPositronAPI();
		if (!positron) {
			return;
		}
		const session = await positron.runtime.getForegroundSession();
		if (!session) {
			return;
		}
		// Get the code to execute but ignore dependencies check since we can't ensure them with BaseLanguageRuntimeSession
		const { code } = getCodeForUri(
			session.runtimeMetadata.languageId,
			uri,
			node.type,
		);

		// Skip dependency checking for now since it requires a full LanguageRuntimeSession
		// Note: The proper fix would be to modify the positron API to handle BaseLanguageRuntimeSession
		// or get a full LanguageRuntimeSession instance through another method
		if (session.runtimeMetadata.languageId === 'r') {
			// For R, we would normally ensure dependencies, but we'll skip this step
			// due to the type incompatibility between BaseLanguageRuntimeSession and LanguageRuntimeSession
			console.warn('R session dependencies check skipped - using catalog items may require manual package installation');
		}

		session.execute(
			code,
			session.runtimeMetadata.languageId,
			positron.RuntimeCodeExecutionMode.Interactive,
			positron.RuntimeErrorBehavior.Continue,
		);
	}

	private async uriWithWarehouse(
		node: CatalogNode,
	): Promise<vscode.Uri | undefined> {
		if (!node.resourceUri) {
			return;
		}
		if (node.type === 'table') {
			await this.chooseWarehouse();
			if (!this.warehousePath) {
				return;
			}
			return withHttpPath(node.resourceUri, this.warehousePath);
		}
		return node.resourceUri;
	}

	private async chooseWarehouse() {
		if (this.warehousePath) {
			return;
		}
		const warehouses = await getSqlWarehouses(this.workspace, this.token);
		const items = warehouses.map((v) => {
			return {
				item: v,
				label: v.name,
				description: `ID: ${v.id}`,
				detail: `[${v.warehouse_type}] SQL Warehouse`,
			};
		});
		const choice = await vscode.window.showQuickPick(items, {
			title: 'Choose an SQL Warehouse for the Connection',
		});
		if (!choice) {
			return undefined;
		}
		this.warehousePath = choice.item.odbc_params.path;
	}
}

function getCodeForUri(
	languageId: string,
	uri: vscode.Uri,
	type: CatalogNodeType,
): { code: string; dependencies: string[] } {
	switch (languageId + '_' + type) {
		case 'python_file':
			return getPythonCodeForFile(uri);
		case 'python_table':
			return getPythonCodeForTable(uri);
		case 'r_file':
			return getRCodeForFile(uri);
		case 'r_table':
			return getRCodeForTable(uri);
		default:
			throw new Error(
				`Code generation for language '${languageId}' and type '${type}' is not yet supported`,
			);
	}
}

function getPythonCodeForFile(uri: vscode.Uri): {
	code: string;
	dependencies: string[];
} {
	const dependencies = ['databricks-sdk', 'pandas'];
	const ext = path.extname(uri.path);
	const varname = nameToIdentifier(path.basename(uri.path).replace(ext, ''));
	const code = `# pip install ${dependencies.join(' ')}

import pandas as pd
from databricks.sdk import WorkspaceClient
from io import BytesIO

w = WorkspaceClient(host="https://${uri.authority}")
${varname} = pd.read_csv(
	BytesIO(w.files.download("${uri.path}").contents.read())
)
`;
	return { code, dependencies };
}

function getPythonCodeForTable(uri: vscode.Uri): {
	code: string;
	dependencies: string[];
} {
	const params = new URLSearchParams(uri.query);
	const catalog = params.get('catalog');
	const schema = params.get('schema');
	const table = uri.path.replace(/^\//, '');
	const httpPath = params.get('http_path');
	if (!catalog || !schema || !httpPath) {
		throw new Error('Malformed Databricks table URI');
	}
	const dependencies = ['databricks-sql-connector', 'pyarrow', 'pandas'];
	const varname = nameToIdentifier(table);
	const code = `# pip install ${dependencies.join(' ')}

import pandas as pd
from databricks import sql

conn = sql.connect(
	server_hostname="https://${uri.authority}",
	http_path="${httpPath}",
)

with conn.cursor() as cursor:
	cursor.execute("SELECT * FROM \`${catalog}\`.\`${schema}\`.\`${table}\` LIMIT 1000;")
	${varname} = cursor.fetchall_arrow().to_pandas()
`;
	return { code, dependencies };
}

function getRCodeForFile(uri: vscode.Uri): {
	code: string;
	dependencies: string[];
} {
	const dependencies = ['brickster'];
	const ext = path.extname(uri.path);
	const varname = nameToIdentifier(path.basename(uri.path).replace(ext, ''));
	let code: string;
	switch (ext) {
		// Special handling for the common case of CSV files.
		case '.csv':
		case '.tsv':
			dependencies.push('readr');
			code = `${varname} <- readr::read_csv(
	brickster::db_volume_read(
		"${uri.path}",
		tempfile(pattern = "${ext}"),
		host = "${uri.authority}"
	)
)`;
			break;
		default:
			code = `${varname}_path <- brickster::db_volume_read(
	"${uri.path}",
	tempfile(pattern = "${ext}"),
	host = "${uri.authority}"
)`;
			break;
	}
	return { code, dependencies };
}

function getRCodeForTable(uri: vscode.Uri): {
	code: string;
	dependencies: string[];
} {
	const params = new URLSearchParams(uri.query);
	const catalog = params.get('catalog');
	const schema = params.get('schema');
	const table = uri.path.replace(/^\//, '');
	const httpPath = params.get('http_path');
	if (!catalog || !schema || !httpPath) {
		throw new Error('Malformed Databricks table URI');
	}
	const dependencies = ['odbc', 'dplyr'];
	const varname = nameToIdentifier(table);
	const code = `conn <- DBI::dbConnect(
	odbc::databricks(),
	workspace = "${uri.authority}",
	httpPath = "${httpPath}"
)
${varname} <- dplyr::tbl(conn, I("${catalog}.${schema}.${table}"))
`;
	return { code, dependencies };
}

function nameToIdentifier(name: string): string {
	// TODO: More escaping.
	return name.replace('-', '_');
}

/**
 * Constructs a URI for a Databricks table, largely following the format used
 * by the https://github.com/databricks/databricks-sqlalchemy/ bridge, but with
 * the table name as the path so that VS Code renders it correctly.
 */
export function databricksTableUri(
	workspace: string,
	catalog: string,
	schema: string,
	table: string,
	httpPath: string | undefined,
): vscode.Uri {
	return vscode.Uri.from({
		scheme: 'databricks',
		authority: workspace,
		path: '/' + table,
		query: new URLSearchParams({
			catalog,
			schema,
			...(httpPath && { http_path: httpPath }),
		}).toString(),
	});
}

/**
 * Adds the HTTP path to the given URI as a query parameter.
 * @param uri A URI.
 * @param httpPath An HTTP path parameter.
 * @returns A modified URI.
 */
function withHttpPath(uri: vscode.Uri, httpPath: string): vscode.Uri {
	const params = new URLSearchParams(uri.query);
	params.set('http_path', httpPath);
	return uri.with({ query: params.toString() });
}

/**
 * Looks up available SQL warehouses for the given workspace.
 * @param workspace A Databricks workspace.
 * @param token A bearer token for the Databricks API.
 * @returns A list of warehouses.
 */
async function getSqlWarehouses(
	workspace: string,
	token: string,
): Promise<Warehouse[]> {
	const response = await fetch(`https://${workspace}/api/2.0/sql/warehouses`, {
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${token}`,
		},
	});
	// TODO: More precise error handling.
	if (!response.ok) {
		throw new Error(`Request failed with status ${response.status}`);
	}
	interface ListWarehousesReponse {
		warehouses: Array<Warehouse>;
	}
	const body = (await response.json()) as ListWarehousesReponse;
	return body.warehouses;
}

interface Warehouse {
	id: string;
	name: string;
	state: string;
	warehouse_type: string;
	odbc_params: {
		path: string;
	};
}

const STATE_KEY = 'databricksWorkspaces';
