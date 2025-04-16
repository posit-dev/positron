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
	) {}

	async getDetails(): Promise<string | undefined> {
		return await this.provider.getDetails(this);
	}

	async getChildren(): Promise<CatalogNode[]> {
		return await this.provider.getChildren(this);
	}

	getTreeItem(): vscode.TreeItem {
		const label = this.path.split(".").pop() || this.path;
		return new CatalogItem(label, this.type);
	}
}

type CatalogElement = CatalogNode | CatalogProvider;

export class CatalogTreeDataProvider
	implements vscode.TreeDataProvider<CatalogElement>, vscode.Disposable
{
	private providers: CatalogProvider[] = [];
	private disposables: vscode.Disposable[] = [];

	constructor(...providers: CatalogProvider[]) {
		this.providers.concat(...providers);
	}

	dispose() {
		vscode.Disposable.from(...this.providers).dispose();
		vscode.Disposable.from(...this.disposables).dispose();
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
	constructor(public readonly label: string, type: CatalogNodeType) {
		super(label);
		switch (type) {
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
			default:
				this.iconPath = TABLE_ICON;
				break;
		}
	}
}
