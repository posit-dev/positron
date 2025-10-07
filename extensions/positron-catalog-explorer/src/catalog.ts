/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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

	getCode?(languageId: string, node: CatalogNode): Promise<string | undefined>;

	openInSession?(node: CatalogNode): Promise<void>;

	refresh?(): void;

	onDidChange?: vscode.Event<void>;
}

export type CatalogNodeType =
	| 'provider'
	| 'catalog'
	| 'schema'
	| 'namespace' // Iceberg terminology for a generalized catalog/schema hierarchy.
	| 'table'
	| 'view'
	| 'volume' // Unity Catalog terminology. Also called a "bucket" or "container".
	| 'directory'
	| 'file'; // Also called an "object".

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

	async getCode(languageId: string): Promise<string | undefined> {
		if (!this.provider.getCode) {
			vscode.window.showErrorMessage(
				'Code generation is not supported by this provider.',
			);
			return Promise.resolve(undefined);
		}
		return await this.provider.getCode(languageId, this);
	}

	async openInSession() {
		if (!this.provider.openInSession) {
			return;
		}
		await this.provider.openInSession(this);
	}
}

export async function registerTreeViewProvider(
	context: vscode.ExtensionContext,
	registry: CatalogProviderRegistry,
): Promise<vscode.Disposable> {
	return vscode.window.registerTreeDataProvider(
		'catalog-explorer',
		await CatalogTreeDataProvider.from(context, registry),
	);
}

type CatalogElement = CatalogNode | CatalogProvider;

class CatalogTreeDataProvider
	implements vscode.TreeDataProvider<CatalogElement>, vscode.Disposable
{
	private listeners: vscode.Disposable[] = [];
	private emitter = new vscode.EventEmitter<CatalogElement | void>();

	static async from(
		context: vscode.ExtensionContext,
		registry: CatalogProviderRegistry,
	): Promise<CatalogTreeDataProvider> {
		const providers = await registry.listAllProviders(context);
		return new CatalogTreeDataProvider(providers, registry);
	}

	private constructor(
		private providers: CatalogProvider[],
		registry: CatalogProviderRegistry,
	) {
		this.listeners.push(
			registry.onCatalogAdded((provider) => {
				this.providers.push(provider);
				this.emitter.fire();
			}),
		);
		for (const p of this.providers) {
			if (!p.onDidChange) {
				continue;
			}
			this.listeners.push(p.onDidChange(() => this.emitter.fire()));
		}
	}

	onDidChangeTreeData = this.emitter.event;

	dispose() {
		vscode.Disposable.from(...this.providers, ...this.listeners).dispose();
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
	'symbol-class',
	new vscode.ThemeColor('symbolIcon.methodForeground'),
);

const CATALOG_ICON = new vscode.ThemeIcon(
	'library',
	new vscode.ThemeColor('symbolIcon.classForeground'),
);

const NAMESPACE_ICON = new vscode.ThemeIcon(
	'bracket',
	new vscode.ThemeColor('symbolIcon.namespaceForeground'),
);

const TABLE_ICON = new vscode.ThemeIcon(
	'database',
	new vscode.ThemeColor('symbolIcon.fieldForeground'),
);

class CatalogItem extends vscode.TreeItem {
	constructor(node: CatalogNode) {
		if (node.resourceUri) {
			super(node.resourceUri);
		} else {
			super(node.path.split('.').pop() || node.path);
		}
		this.contextValue = node.type;
		switch (node.type) {
			case 'provider':
				this.iconPath = DEFAULT_PROVIDER_ICON;
				// Expand only "provider" entries by default.
				this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
				break;
			case 'catalog':
				this.iconPath = CATALOG_ICON;
				this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
				break;
			case 'schema':
			case 'namespace':
				this.iconPath = NAMESPACE_ICON;
				this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
				break;
			case 'volume':
			case 'directory':
				this.iconPath = vscode.ThemeIcon.Folder;
				this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
				break;
			case 'file':
				this.iconPath = vscode.ThemeIcon.File;
				if (this.resourceUri) {
					this.command = {
						title: 'Open',
						command: 'vscode.open',
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

export interface CatalogProviderRegistration {
	label: string;
	detail?: string;
	iconPath?: vscode.IconPath;
	addProvider(
		context: vscode.ExtensionContext,
	): Promise<CatalogProvider | undefined>;
	listProviders(context: vscode.ExtensionContext): Promise<CatalogProvider[]>;
}

export class CatalogProviderRegistry {
	private registry: CatalogProviderRegistration[] = [];
	private addCatalog = new vscode.EventEmitter<CatalogProvider>();

	onCatalogAdded = this.addCatalog.event;

	register(registration: CatalogProviderRegistration): vscode.Disposable {
		this.registry.push(registration);
		this.registry.sort((a, b) => a.label.localeCompare(b.label));
		return {
			dispose: () => this.unregister(registration),
		};
	}

	async listAllProviders(
		context: vscode.ExtensionContext,
	): Promise<CatalogProvider[]> {
		const all = this.registry.map(async (v) => {
			return {
				label: v.label,
				providers: await v.listProviders(context),
			};
		});
		const sorted = (await Promise.all(all)).sort((a, b) =>
			a.label.localeCompare(b.label),
		);
		return sorted.map((v) => v.providers).flat();
	}

	async addProvider(context: vscode.ExtensionContext): Promise<void> {
		const item = await vscode.window.showQuickPick(this.registry, {
			title: 'Choose a Catalog Provider',
		});
		if (!item) {
			return;
		}
		const added = await item.addProvider(context);
		if (!added) {
			return;
		}
		this.addCatalog.fire(added);
	}

	private unregister(registration: CatalogProviderRegistration) {
		this.registry = this.registry.filter((v) => v !== registration);
	}
}

export function registerCatalogCommands(
	context: vscode.ExtensionContext,
	registry: CatalogProviderRegistry,
) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'posit.catalog-explorer.openWith',
			async (node: CatalogNode) => {
				if (!node.resourceUri) {
					return;
				}
				// Delegate to the existing File Explorer
				// command.
				await vscode.commands.executeCommand(
					'explorer.openWith',
					node.resourceUri,
				);
			},
		),
		vscode.commands.registerCommand(
			'posit.catalog-explorer.copyPath',
			async (node: CatalogNode) => {
				if (!node.resourceUri) {
					return;
				}
				// Delegate to the existing copyFilePath
				// command, as used by the File Explorer.
				await vscode.commands.executeCommand('copyFilePath', node.resourceUri);
			},
		),
		vscode.commands.registerCommand(
			'posit.catalog-explorer.openInSession',
			async (node: CatalogNode) => await node.openInSession(),
		),
		vscode.commands.registerCommand(
			'posit.catalog-explorer.copyPythonCode',
			async (node: CatalogNode) => {
				const code = await node.getCode('python');
				if (!code) {
					return;
				}
				await vscode.env.clipboard.writeText(code);
			},
		),
		vscode.commands.registerCommand(
			'posit.catalog-explorer.copyRCode',
			async (node: CatalogNode) => {
				const code = await node.getCode('r');
				if (!code) {
					return;
				}
				await vscode.env.clipboard.writeText(code);
			},
		),
		vscode.commands.registerCommand(
			'posit.catalog-explorer.refresh',
			(provider: CatalogProvider) => provider.refresh?.(),
		),
		vscode.commands.registerCommand(
			'posit.catalog-explorer.addCatalogProvider',
			async () => await registry.addProvider(context),
		),
	);
}
