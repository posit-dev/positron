/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	CatalogProvider,
	CatalogNode,
	CatalogProviderRegistration,
	CatalogProviderRegistry,
} from '../catalog';

const mockRegistration: CatalogProviderRegistration = {
	label: 'Demo Catalog',
	detail: 'A demo catalog for testing purposes',
	iconPath: new vscode.ThemeIcon('beaker'),
	addProvider: () => Promise.resolve(new MockCatalogProvider()),
	listProviders: () => Promise.resolve([]),
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

	dispose() {
		this.onDidChangeEmitter.dispose();
	}

	getTreeItem(): vscode.TreeItem {
		const item = new vscode.TreeItem(
			mockRegistration.label,
			vscode.TreeItemCollapsibleState.Expanded,
		);
		item.description = mockRegistration.detail;
		item.iconPath = mockRegistration.iconPath;
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
					`${node.path}/file.csv`,
					'file',
					this,
					vscode.Uri.parse(`mock://${node.path}/file.csv`),
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
