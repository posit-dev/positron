/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { CatalogNode, CatalogProvider } from "../catalog";
import { UnityCatalogClient } from "./unityCatalogClient";
import { DatabricksFilesClient, dbfsUri, dbfsVolumeUri } from "../fs/dbfs";
import { resourceUri } from "../resources";
import { DefaultDatabricksCredentialProvider } from "../credentials";

/**
 * Register a Databricks catalog provider for the given workspace using a PAT
 * as a credential.
 */
export async function registerDatabricksCatalog(
	context: vscode.ExtensionContext,
	workspace: string,
	token: string,
) {
	const registered = context.globalState.get<string[]>(STATE_KEY);
	const next: Set<string> = registered ? new Set(registered) : new Set();
	next.add(workspace);
	await context.globalState.update(STATE_KEY, Array.from(next));
	await context.secrets.store(workspace, token);
}

/**
 * Get all registered Databricks catalogs for which we have credentials.
 */
export async function getDatabricksCatalogs(
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
	static label = "Databricks";
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

	getTreeItem(): vscode.TreeItem {
		const item = new vscode.TreeItem(
			DatabricksCatalogProvider.label,
			vscode.TreeItemCollapsibleState.Expanded,
		);
		item.iconPath = {
			light: resourceUri("light", "databricks.svg"),
			dark: resourceUri("dark", "databricks.svg"),
		};
		item.tooltip = DatabricksCatalogProvider.label;
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
}

const STATE_KEY = "databricksWorkspaces";
