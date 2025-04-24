/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

/**
 * High-level interface for arbitrary backends that provide a hierarchical
 * tree (or "catalog") of data sources to explore.
 */
export interface CatalogProvider extends vscode.Disposable {
	/**
	 * Get the {@link vscode.TreeItem} representation of this provider.
	 */
	getTreeItem(): vscode.TreeItem;

	/**
	 * Get additional details about the given node, if any.
	 */
	getDetails(node: CatalogNode): Promise<string | undefined>;

	/**
	 * Get the children of the given node, or the top-level children of the
	 * provider if `node` is undefined.
	 */
	getChildren(node?: CatalogNode): Promise<CatalogNode[]>;

	openInSession?(node: CatalogNode): Promise<void>;
}

export type CatalogNodeType =
	| "provider"
	| "catalog"
	| "schema"
	| "namespace" // Iceberg terminology for a generalized catalog/schema hierarchy.
	| "table"
	| "view"
	| "volume" // Unity Catalog terminology. Also called a "bucket" or "container".
	| "directory"
	| "file"; // Also called an "object".

export class CatalogNode {
	constructor(
		public readonly path: string,
		public readonly type: CatalogNodeType,
		public readonly provider: CatalogProvider,
		public readonly resourceUri?: vscode.Uri,
	) {}

	async getDetails(): Promise<string | undefined> {
		return await this.provider.getDetails(this);
	}

	async getChildren(): Promise<CatalogNode[]> {
		return await this.provider.getChildren(this);
	}

	getTreeItem(): vscode.TreeItem {
		return new CatalogItem(this);
	}

	async openInSession() {
		if (!this.provider.openInSession) {
			return;
		}
		await this.provider.openInSession(this);
	}
}

type CatalogElement = CatalogNode | CatalogProvider;

export class CatalogTreeDataProvider
	implements vscode.TreeDataProvider<CatalogElement>, vscode.Disposable
{
	private providers: CatalogProvider[];

	constructor(...providers: CatalogProvider[]) {
		this.providers = providers;
	}

	dispose() {
		vscode.Disposable.from(...this.providers).dispose();
	}

	getTreeItem(element: CatalogElement): vscode.TreeItem {
		return element.getTreeItem();
	}

	async getChildren(element?: CatalogElement): Promise<CatalogElement[]> {
		if (!element) {
			return Promise.resolve(this.providers);
		}
		return await element.getChildren();
	}

	async resolveTreeItem(
		item: vscode.TreeItem,
		element: CatalogNode,
		_token: vscode.CancellationToken,
	): Promise<vscode.TreeItem> {
		if (!item.tooltip) {
			item.tooltip = await element.getDetails();
		}
		return item;
	}
}

const DEFAULT_PROVIDER_ICON = new vscode.ThemeIcon(
	"symbol-class",
	new vscode.ThemeColor("symbolIcon.methodForeground"),
);

const CATALOG_ICON = new vscode.ThemeIcon(
	"library",
	new vscode.ThemeColor("symbolIcon.classForeground"),
);

const NAMESPACE_ICON = new vscode.ThemeIcon(
	"bracket",
	new vscode.ThemeColor("symbolIcon.namespaceForeground"),
);

const TABLE_ICON = new vscode.ThemeIcon(
	"database",
	new vscode.ThemeColor("symbolIcon.fieldForeground"),
);

class CatalogItem extends vscode.TreeItem {
	constructor(node: CatalogNode) {
		if (node.resourceUri) {
			super(node.resourceUri);
		} else {
			super(node.path.split(".").pop() || node.path);
		}
		this.contextValue = node.type;
		switch (node.type) {
			case "provider":
				this.iconPath = DEFAULT_PROVIDER_ICON;
				// Expand only "provider" entries by default.
				this.collapsibleState =
					vscode.TreeItemCollapsibleState.Expanded;
				break;
			case "catalog":
				this.iconPath = CATALOG_ICON;
				this.collapsibleState =
					vscode.TreeItemCollapsibleState.Collapsed;
				break;
			case "schema":
			case "namespace":
				this.iconPath = NAMESPACE_ICON;
				this.collapsibleState =
					vscode.TreeItemCollapsibleState.Collapsed;
				break;
			case "volume":
			case "directory":
				this.iconPath = vscode.ThemeIcon.Folder;
				this.collapsibleState =
					vscode.TreeItemCollapsibleState.Collapsed;
				break;
			case "file":
				this.iconPath = vscode.ThemeIcon.File;
				if (this.resourceUri) {
					this.command = {
						title: "Open",
						command: "vscode.open",
						arguments: [this.resourceUri],
					};
				}
				break;
			default:
				this.iconPath = TABLE_ICON;
				break;
		}
	}
}

export function registerCatalogCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"positron-catalog-explorer.openWith",
			async (node: CatalogNode) => {
				if (!node.resourceUri) {
					return;
				}
				// Delegate to the existing File Explorer
				// command.
				await vscode.commands.executeCommand(
					"explorer.openWith",
					node.resourceUri,
				);
			},
		),
		vscode.commands.registerCommand(
			"positron-catalog-explorer.copyPath",
			async (node: CatalogNode) => {
				if (!node.resourceUri) {
					return;
				}
				// Delegate to the existing copyFilePath
				// command, as used by the File Explorer.
				await vscode.commands.executeCommand(
					"copyFilePath",
					node.resourceUri,
				);
			},
		),
		vscode.commands.registerCommand(
			"positron-catalog-explorer.openInSession",
			async (node: CatalogNode) => await node.openInSession(),
		),
	);
}
