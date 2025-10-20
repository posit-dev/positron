/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { CatalogProviderRegistry } from '../catalog';
import {
	MockCatalogProvider,
	registerMockProvider,
	mockProviderInstances,
} from '../catalogs/mock';

suite('Mock Catalog Provider Tests', () => {
	let sandbox: sinon.SinonSandbox;
	let registry: CatalogProviderRegistry;
	let mockExtensionContext: vscode.ExtensionContext;

	setup(function () {
		sandbox = sinon.createSandbox();

		// Clear any existing mock provider instances
		mockProviderInstances.clear();

		// Create a mock extension context
		mockExtensionContext = {
			subscriptions: [],
			extensionUri: vscode.Uri.parse('file:///mock-extension'),
			extensionPath: '/mock-extension',
			storagePath: '/mock-storage',
			globalState: {
				get: sandbox.stub().returns(undefined),
				update: sandbox.stub().resolves(),
				setKeysForSync: sandbox.stub(),
				keys: sandbox.stub().returns([]),
			},
			workspaceState: {
				get: sandbox.stub().returns(undefined),
				update: sandbox.stub().resolves(),
				keys: sandbox.stub().returns([]),
			},
			secrets: {
				get: sandbox.stub().resolves(undefined),
				store: sandbox.stub().resolves(),
				delete: sandbox.stub().resolves(),
			},
			extensionMode: vscode.ExtensionMode.Development,
			globalStoragePath: '/mock-global-storage',
			logPath: '/mock-logs',
			storageUri: vscode.Uri.parse('file:///mock-storage'),
			globalStorageUri: vscode.Uri.parse('file:///mock-global-storage'),
			logUri: vscode.Uri.parse('file:///mock-logs'),
			asAbsolutePath: (relativePath: string) =>
				`/mock-extension/${relativePath}`,
		} as unknown as vscode.ExtensionContext;

		// Create a new registry for each test
		registry = new CatalogProviderRegistry();

		// Stub the vscode.window methods
		sandbox.stub(vscode.window, 'showInformationMessage').resolves();
		sandbox
			.stub(vscode.window, 'showWarningMessage')
			.resolves({ title: 'Yes' } as any);

		// Important: Stub showQuickPick to return the mock registration
		sandbox.stub(vscode.window, 'showQuickPick').callsFake((items) => {
			// Make it always select the mock provider in the quick pick
			if (Array.isArray(items)) {
				const mockItem = items.find(
					(item: any) =>
						item.label === 'Demo Catalog' ||
						(typeof item === 'object' && item.label === 'Demo Catalog'),
				);
				return Promise.resolve(mockItem || items[0]);
			}
			return Promise.resolve(items);
		});

		// Register the mock provider for all tests
		registerMockProvider(registry);
	});

	teardown(function () {
		mockProviderInstances.clear();
		sandbox.restore();
	});

	test('Mock provider can be registered with the registry', async () => {
		// Check if registry includes our registration
		const providers = await registry.listAllProviders(mockExtensionContext);

		// Initially, there should be no providers since none have been added yet
		assert.strictEqual(
			providers.length,
			0,
			'No providers should be listed initially',
		);
	});

	test('Mock provider can be added and returns expected structure', async () => {
		// Add a mock provider instance via the registry (which uses quickPick)
		await registry.addProvider(mockExtensionContext);

		// Get all providers from the registry
		const providers = await registry.listAllProviders(mockExtensionContext);

		// Now there should be one provider
		assert.strictEqual(providers.length, 1, 'One provider should be listed');

		// Check if it's the right type
		assert.ok(
			providers[0] instanceof MockCatalogProvider,
			'Provider should be a MockCatalogProvider',
		);

		// Check provider ID
		assert.strictEqual(
			providers[0].id,
			'mock:demo',
			'Provider ID should match',
		);

		// Check provider tree item
		const treeItem = providers[0].getTreeItem();
		assert.strictEqual(
			treeItem.label,
			'Demo Catalog',
			'Provider label should match',
		);
		assert.strictEqual(
			treeItem.description,
			'A demo catalog for testing purposes',
			'Provider description should match',
		);
		assert.strictEqual(
			treeItem.contextValue,
			'provider',
			'contextValue should be set to "provider"',
		);

		// Check if the instance is tracked in the mock provider set
		assert.strictEqual(
			mockProviderInstances.size,
			1,
			'Provider should be tracked in the instance set',
		);
	});

	test('Mock provider can be removed successfully', async () => {
		// Add a mock provider instance
		await registry.addProvider(mockExtensionContext);

		// Get all providers from the registry
		const providers = await registry.listAllProviders(mockExtensionContext);
		assert.strictEqual(
			providers.length,
			1,
			'One provider should be listed after adding',
		);

		// Remove the provider
		const result = await registry.removeProvider(
			providers[0],
			mockExtensionContext,
		);
		assert.strictEqual(result, true, 'removeProvider should return true');

		// Check providers list again
		const remainingProviders =
			await registry.listAllProviders(mockExtensionContext);
		assert.strictEqual(
			remainingProviders.length,
			0,
			'No providers should remain after removal',
		);

		// Check if the instance was removed from the tracking set
		assert.strictEqual(
			mockProviderInstances.size,
			0,
			'Provider should be removed from the instance set',
		);
	});

	test('UI is updated when provider is removed via events', async () => {
		// Create spy for the event emitter
		const emitterFireSpy = sandbox.spy();

		// Create a spy for the registry's removeCatalog event
		const removeCatalogSpy = sandbox.spy();

		// Subscribe to the onCatalogRemoved event
		const disposable = registry.onCatalogRemoved(removeCatalogSpy);

		// Add a mock provider instance
		await registry.addProvider(mockExtensionContext);

		// Get the provider
		const providers = await registry.listAllProviders(mockExtensionContext);
		const mockProvider = providers[0];

		// Create a fake tree data provider to test events
		const fakeTreeDataProvider = {
			providers: [mockProvider],
			emitter: { fire: emitterFireSpy },
			listeners: [],
		};

		// Simulate the listener that would be added in CatalogTreeDataProvider
		const listener = (provider: any) => {
			try {
				const providerId = provider.id;
				const matchIndex = fakeTreeDataProvider.providers.findIndex(
					(p) => p.id === providerId,
				);

				if (matchIndex >= 0) {
					// Remove the provider from our list
					fakeTreeDataProvider.providers.splice(matchIndex, 1);
					// Notify tree view to refresh
					fakeTreeDataProvider.emitter.fire();
				}
			} catch (e) {
				console.error('Error in provider removal by id:', e);
			}
		};

		// Add the listener to our registry
		registry.onCatalogRemoved(listener);

		// Remove the provider
		const result = await registry.removeProvider(
			mockProvider,
			mockExtensionContext,
		);
		assert.strictEqual(result, true, 'removeProvider should return true');

		// Check if the event was fired
		assert.strictEqual(
			removeCatalogSpy.callCount,
			1,
			'onCatalogRemoved event should fire once',
		);
		assert.strictEqual(
			removeCatalogSpy.firstCall.args[0],
			mockProvider,
			'Event should receive the removed provider',
		);

		// Check if our fake tree data provider's emitter was fired
		assert.strictEqual(
			emitterFireSpy.callCount,
			1,
			'Tree data provider should refresh the UI',
		);

		// Check that the provider was removed from our fake tree data provider
		assert.strictEqual(
			fakeTreeDataProvider.providers.length,
			0,
			'Provider should be removed from the tree data provider',
		);

		// Clean up
		disposable.dispose();
	});

	test('Adding multiple providers creates distinct instances', async () => {
		// Add two mock provider instances
		await registry.addProvider(mockExtensionContext);
		await registry.addProvider(mockExtensionContext);

		// Get all providers from the registry
		const providers = await registry.listAllProviders(mockExtensionContext);

		// There should be two providers
		assert.strictEqual(providers.length, 2, 'Two providers should be listed');

		// Both should be MockCatalogProviders
		assert.ok(
			providers.every((p) => p instanceof MockCatalogProvider),
			'All providers should be MockCatalogProviders',
		);

		// Both should have the same ID but be different instances
		assert.strictEqual(
			providers[0].id,
			providers[1].id,
			'Provider IDs should match',
		);
		assert.notStrictEqual(
			providers[0],
			providers[1],
			'Providers should be different instances',
		);

		// Check that both instances are tracked in the set
		assert.strictEqual(
			mockProviderInstances.size,
			2,
			'Two providers should be tracked in the instance set',
		);
	});

	test('Provider disposal cleans up resources correctly', async () => {
		// Add a mock provider instance
		await registry.addProvider(mockExtensionContext);

		// Get all providers
		const providers = await registry.listAllProviders(mockExtensionContext);
		const mockProvider = providers[0] as MockCatalogProvider;

		// Spy on the event emitter's dispose method
		const disposeSpy = sandbox.spy(
			mockProvider['onDidChangeEmitter'],
			'dispose',
		);

		// Dispose the provider
		mockProvider.dispose();

		// Check if the emitter was disposed
		assert.strictEqual(
			disposeSpy.callCount,
			1,
			'Event emitter should be disposed',
		);

		// Check if the provider was removed from the tracking set
		assert.strictEqual(
			mockProviderInstances.size,
			0,
			'Provider should be removed from tracking set after disposal',
		);

		// Check providers list again to ensure it's gone
		const remainingProviders =
			await registry.listAllProviders(mockExtensionContext);
		assert.strictEqual(
			remainingProviders.length,
			0,
			'Provider should not be listed after disposal',
		);
	});
});
