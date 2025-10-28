/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { traceLog, traceInfo, traceWarn, traceError } from './logging';

/**
 * High-level interface for arbitrary backends that provide a hierarchical
 * tree (or "catalog") of data sources to explore.
 */
export interface CatalogProvider extends vscode.Disposable {
	/**
	 * A unique identifier for this provider instance.
	 */
	id: string;

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
	) { }

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
	const treeDataProvider = await CatalogTreeDataProvider.from(
		context,
		registry,
	);
	const treeView = vscode.window.createTreeView('catalog-explorer', {
		treeDataProvider: treeDataProvider,
		showCollapseAll: true,
	});

	context.subscriptions.push(treeView);
	return {
		dispose: () => {
			treeView.dispose();
		},
	};
}

type CatalogElement = CatalogNode | CatalogProvider;

class CatalogTreeDataProvider
	implements vscode.TreeDataProvider<CatalogElement>, vscode.Disposable {
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
		this.listeners.push(
			registry.onCatalogRemoved((provider) => {
				// Try to match by id
				try {
					const providerId = provider.id;
					const matchIndex = this.providers.findIndex(
						(p) => p.id === providerId,
					);

					if (matchIndex >= 0) {
						// Remove the provider from our list
						this.providers.splice(matchIndex, 1);
						// Notify tree view to refresh
						this.emitter.fire();
					}
				} catch (e) {
					traceError(`Error in provider removal by id: ${e}`);
				}
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
				this.tooltip = node.provider.id;
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
		account?: string,
	): Promise<CatalogProvider | undefined>;
	removeProvider?(
		context: vscode.ExtensionContext,
		provider: CatalogProvider,
	): Promise<void>;
	listProviders(context: vscode.ExtensionContext): Promise<CatalogProvider[]>;
}

export class CatalogProviderRegistry {
	private registry: CatalogProviderRegistration[] = [];
	private addCatalog = new vscode.EventEmitter<CatalogProvider>();
	private removeCatalog = new vscode.EventEmitter<CatalogProvider>();

	onCatalogAdded = this.addCatalog.event;
	onCatalogRemoved = this.removeCatalog.event;

	register(registration: CatalogProviderRegistration): vscode.Disposable {
		traceInfo(`Registering catalog provider: ${registration.label}`);
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

	async addProvider(context: vscode.ExtensionContext, provider?: CatalogProviderRegistration, account?: string): Promise<void> {
		let item = provider;
		if (!provider) {
			item = await vscode.window.showQuickPick(this.registry, {
				title: 'Choose a Catalog Provider',
			});
		}
		if (!item) {
			return;
		}

		if (account) {
			try {
				const allProviders = await this.listAllProviders(context);

				// Look for placeholder providers with the same account name
				const placeholders = allProviders.filter(p =>
					p.getTreeItem().contextValue?.includes('placeholder')
				);

				// Remove any matching placeholders
				for (const placeholder of placeholders) {
					await this.removeProvider(placeholder, context);
				}
			} catch (error) {
				console.warn('Error removing placeholder provider:', error);
				// Continue with adding the new provider even if removing placeholder fails
			}
		}
		const added = await item.addProvider(context, account);
		if (!added) {
			traceWarn(`Failed to add catalog provider: ${item.label}`);
			return;
		}
		traceInfo(`Successfully added catalog provider: ${item.label}`);
		this.addCatalog.fire(added);
	}
	async removeProvider(
		provider: CatalogProvider,
		context: vscode.ExtensionContext,
	): Promise<boolean> {
		try {
			const providerId = provider.id;
			traceInfo(`Attempting to remove provider with ID: ${providerId}`);

			for (const registration of this.registry) {
				const providers = await registration.listProviders(context);
				const matchingProvider = providers.find((p) => p.id === providerId);

				if (!matchingProvider) {
					continue;
				}

				// Call the registration's removeProvider method if available
				if (registration.removeProvider) {
					await registration.removeProvider(context, matchingProvider);
				}

				// Notify listeners to update UI
				// Ensure resources are properly cleaned up
				this.removeCatalog.fire(matchingProvider);
				matchingProvider.dispose();
				traceInfo('Provider successfully removed');

				return true;
			}

			// Did not find a matching provider
			traceWarn(`No matching provider found for ID: ${providerId}`);
			return false;
		} catch (error) {
			traceError(`Error removing provider: ${error}`);
			return false;
		}
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
			async (provider?, account?) => await registry.addProvider(context, provider, account),
		),
		vscode.commands.registerCommand(
			'posit.catalog-explorer.removeCatalogProvider',
			async (provider?: CatalogProvider) => {
				try {
					// If provider is not specified (when invoked from command palette),
					// show a quick pick to select a provider
					if (!provider) {
						traceLog('No provider specified, showing provider selection');
						const allProviders = await registry.listAllProviders(context);

						if (allProviders.length === 0) {
							traceWarn('No catalog providers found to remove');
							vscode.window.showInformationMessage(
								'No catalog providers found to remove.',
							);
							return;
						}

						const providerItems = allProviders.map((p) => {
							const label =
								p.getTreeItem().label?.toString() || 'Unnamed Provider';

							const description = p.getTreeItem().description?.toString() || p.id;

							return {
								label,
								description,
								provider: p,
							};
						});

						const selected = await vscode.window.showQuickPick(providerItems, {
							title: 'Select a catalog provider to remove',
							placeHolder: 'Choose a provider to remove',
						});

						if (!selected) {
							traceLog('User cancelled provider selection');
							return;
						}

						provider = selected.provider;
					}

					if (!provider) {
						traceError('Provider is undefined after selection attempt');
						vscode.window.showErrorMessage(
							'Cannot remove connection: No provider selected',
						);
						return;
					}

					// Ask for confirmation before removing
					const providerLabel =
						provider.getTreeItem().label?.toString() || 'Unknown';

					const confirmation = await vscode.window.showWarningMessage(
						`Are you sure you want to remove the ${providerLabel} connection?`,
						{ modal: true },
						'Yes',
						'No',
					);

					if (confirmation !== 'Yes') {
						traceLog('User cancelled removal');
						return;
					}

					await registry.removeProvider(provider, context);
				} catch (error) {
					traceError(`Error in command handler: ${error}`);
					vscode.window.showErrorMessage(
						`Failed to remove connection: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			},
		),
	);
}
