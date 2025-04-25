/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
	CatalogNode,
	CatalogProvider,
	CatalogProviderRegistration,
	CatalogProviderRegistry,
} from "../catalog";
import { UnityCatalogClient } from "./unityCatalogClient";
import { DatabricksFilesClient, dbfsUri, dbfsVolumeUri } from "../fs/dbfs";
import { resourceUri } from "../resources";
import { DefaultDatabricksCredentialProvider } from "../credentials";
import { ensureDependencies, getPositronAPI } from "../positron";
import path from "path";

const registration: CatalogProviderRegistration = {
	label: "Databricks",
	detail: "Explore tables, volumes, and files in the Unity Catalog",
	addProvider: registerDatabricksCatalog,
	listProviders: getDatabricksCatalogs,
};

export function registerDatabricksProvider(
	registry: CatalogProviderRegistry,
): vscode.Disposable {
	// We have to do this lazily due to paths not being available until
	// after initialisation.
	registration.iconPath = {
		light: resourceUri("light", "databricks.svg"),
		dark: resourceUri("dark", "databricks.svg"),
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
		title: "Databricks Workspace",
		// Users will likely be copy & pasting this value.
		ignoreFocusOut: true,
		validateInput: (value: string) => {
			if (value.startsWith("https://")) {
				return undefined;
			}
			return {
				message: `Workspace URLs must begin with "https://".`,
				severity: vscode.InputBoxValidationSeverity
					.Error,
			};
		},
	});
	if (!workspace) {
		return;
	}
	const token = await vscode.window.showInputBox({
		title: "Personal Access Token",
		ignoreFocusOut: true,
		password: true,
		validateInput: (value: string) => {
			if (value.startsWith("dapi")) {
				return undefined;
			}
			return {
				message: `Unrecognized token format. Tokens should start with "dapi".`,
				severity: vscode.InputBoxValidationSeverity
					.Warning,
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
 */
export async function unregisterDatabricksCatalog(
	context: vscode.ExtensionContext,
	workspace: string,
): Promise<void> {
	const registered = context.globalState.get<string[]>(STATE_KEY);
	const next: Set<string> = registered ? new Set(registered) : new Set();
	next.delete(workspace);
	await context.globalState.update(STATE_KEY, Array.from(next));
	await context.secrets.delete(workspace);
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
class DatabricksCatalogProvider implements CatalogProvider {
	private emitter = new vscode.EventEmitter<void>();
	private catalogClient: UnityCatalogClient;
	private fsClient: DatabricksFilesClient;
	private workspace: string;

	constructor(workspace: string, token: string) {
		this.workspace = workspace.startsWith("https://")
			? workspace.substring(8)
			: workspace;
		this.catalogClient = new UnityCatalogClient(
			`https://${this.workspace}`,
			token,
		);
		this.fsClient = new DatabricksFilesClient(
			`https://${this.workspace}`,
			token,
		);
	}

	dispose() {}

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
		item.description = this.workspace;
		item.contextValue = "provider";
		return item;
	}

	getDetails(node?: CatalogNode): Promise<string | undefined> {
		if (!node) {
			return Promise.resolve(undefined);
		}
		if (node.type === "catalog") {
			return Promise.resolve(`Catalog: ${node.path}`);
		}
		if (node.type === "schema") {
			return Promise.resolve(`Schema: ${node.path}`);
		}
		return Promise.resolve(undefined);
	}

	async getChildren(node?: CatalogNode): Promise<CatalogNode[]> {
		if (!node) {
			const catalogs =
				await this.catalogClient.listCatalogs();
			return catalogs.map((c) => {
				return new CatalogNode(c.name, "catalog", this);
			});
		}
		if (node.type === "catalog") {
			const schemas = await this.catalogClient.listSchemas(
				node.path,
			);
			return schemas.map((s) => {
				return new CatalogNode(
					`${node.path}.${s.name}`,
					"schema",
					this,
				);
			});
		}
		if (node.type === "schema") {
			const fqn = node.path.split(".");
			const tables = await this.catalogClient.listTables(
				fqn[0],
				fqn[1],
			);
			const volumes = await this.catalogClient.listVolumes(
				fqn[0],
				fqn[1],
			);
			return [
				...tables.map((t) => {
					const path = `${node.path}.${t.name}`;
					return new CatalogNode(
						path,
						"table",
						this,
					);
				}),
				...volumes.map((t) => {
					return new CatalogNode(
						`${node.path}.${t.name}`,
						"volume",
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
		if (node.type === "volume" && node.resourceUri) {
			const contents = await this.fsClient.listContents(
				node.resourceUri.path,
			);
			return contents.map((e) => {
				return new CatalogNode(
					e.name,
					e.is_directory ? "directory" : "file",
					this,
					dbfsUri(this.workspace, e.path),
				);
			});
		}
		return [];
	}

	getCode(languageId: string, node: CatalogNode): string {
		if (node.type !== "file" || !node.resourceUri) {
			throw new Error(
				`Nodes of type '${node.type}' cannot be opened in a session.`,
			);
		}
		const code = getCodeForUri(languageId, node.resourceUri);
		return code.code;
	}

	async openInSession(node: CatalogNode): Promise<void> {
		const positron = getPositronAPI();
		if (!positron) {
			return;
		}
		if (node.type !== "file" || !node.resourceUri) {
			throw new Error(
				`Nodes of type '${node.type}' cannot be opened in a session.`,
			);
		}
		const session = await positron.runtime.getForegroundSession();
		if (!session) {
			return;
		}
		const { code, dependencies } = getCodeForUri(
			session.runtimeMetadata.languageId,
			node.resourceUri,
		);
		if (!(await ensureDependencies(session, dependencies))) {
			return;
		}
		session.execute(
			code,
			session.runtimeMetadata.languageId,
			positron.RuntimeCodeExecutionMode.Interactive,
			positron.RuntimeErrorBehavior.Continue,
		);
	}
}

function getCodeForUri(
	languageId: string,
	uri: vscode.Uri,
): { code: string; dependencies: string[] } {
	if (languageId !== "r") {
		throw new Error("Python sessions are not yet supported");
	}
	const dependencies = ["brickster"];
	const ext = path.extname(uri.path);
	const varname = path.basename(uri.path).replace(ext, "");
	let code: string;
	switch (ext) {
		// Special handling for the common case of CSV files.
		case ".csv":
		case ".tsv":
			dependencies.push("readr");
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

const STATE_KEY = "databricksWorkspaces";
