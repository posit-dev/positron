/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	CatalogProvider,
	CatalogNode,
	CatalogProviderRegistration,
	CatalogProviderRegistry,
} from '../catalog';
import { resourceUri } from '../resources';

// Track provider instances at the module level
export const mockProviderInstances: Set<MockCatalogProvider> = new Set();

const mockRegistration: CatalogProviderRegistration = {
	label: 'Demo Catalog',
	detail: 'A demo catalog for testing purposes',
	iconPath: new vscode.ThemeIcon('beaker'),
	addProvider: () => {
		// Create a new provider instance and track it
		const provider = new MockCatalogProvider();
		mockProviderInstances.add(provider);
		return Promise.resolve(provider);
	},
	removeProvider: (
		_context: vscode.ExtensionContext,
		provider: CatalogProvider,
	): Promise<void> => {
		// Remove from our tracking set
		if (provider instanceof MockCatalogProvider) {
			mockProviderInstances.delete(provider);
		}

		return Promise.resolve();
	},
	listProviders: (_context: vscode.ExtensionContext) => {
		// Return all tracked instances
		return Promise.resolve(Array.from(mockProviderInstances));
	},
};

export function registerMockProvider(
	registry: CatalogProviderRegistry,
): vscode.Disposable {
	return registry.register(mockRegistration);
}

/**
 * A mock implementation of CatalogProvider for testing purposes.
 */
export class MockCatalogProvider implements CatalogProvider {
	private onDidChangeEmitter = new vscode.EventEmitter<void>();
	onDidChange = this.onDidChangeEmitter.event;

	/**
	 * Unique identifier for this provider instance
	 */
	public readonly id: string = 'mock:demo';

	dispose() {
		this.onDidChangeEmitter.dispose();
		mockProviderInstances.delete(this);
	}

	getTreeItem(): vscode.TreeItem {
		const item = new vscode.TreeItem(
			mockRegistration.label,
			vscode.TreeItemCollapsibleState.Expanded,
		);
		item.description = mockRegistration.detail;
		item.iconPath = mockRegistration.iconPath;
		item.contextValue = 'provider';
		return item;
	}

	getDetails(node: CatalogNode): Promise<string | undefined> {
		return Promise.resolve(`Details for ${node.path}`);
	}

	getChildren(node?: CatalogNode): Promise<CatalogNode[]> {
		if (!node) {
			return Promise.resolve([new CatalogNode('catalog', 'catalog', this)]);
		}
		if (node.type === 'catalog') {
			return Promise.resolve([new CatalogNode('schema', 'schema', this)]);
		}
		if (node.type === 'schema') {
			// Mock tables and files under a schema
			return Promise.resolve([
				new CatalogNode('table', 'table', this),
				new CatalogNode(
					`${resourceUri('file.csv')}`,
					'file',
					this,
					vscode.Uri.parse(`${resourceUri('file.csv')}`),
				),
			]);
		}
		return Promise.resolve([]);
	}

	getCode(languageId: string, node: CatalogNode): Promise<string | undefined> {
		return Promise.resolve(`Generated ${languageId} code for ${node.path}`);
	}

	openInSession(node: CatalogNode): Promise<void> {
		vscode.window.showInformationMessage(`Opening session for ${node.path}`);
		return Promise.resolve();
	}

	refresh(): void {
		this.onDidChangeEmitter.fire();
	}
}
