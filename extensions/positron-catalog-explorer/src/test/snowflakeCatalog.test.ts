/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as assert from 'assert';
import { CatalogProviderRegistry } from '../catalog';
import { registerSnowflakeProvider, registerSnowflakeCatalog } from '../catalogs/snowflake';
import { setExtensionUri } from '../resources';
import { SnowflakeMock, TEST_ACCOUNT_NAME, RECENT_SNOWFLAKE_ACCOUNTS_KEY, STATE_KEY_SNOWFLAKE_CONNECTIONS } from './mocks/snowflakeMock';
import * as credentials from '../credentials';

suite('Snowflake Catalog Provider Tests', () => {
	let sandbox: sinon.SinonSandbox;
	let registry: CatalogProviderRegistry;
	let mockExtensionContext: vscode.ExtensionContext;
	let mockGlobalState: Map<string, any>;
	let getConnectionsStub: sinon.SinonStub;
	let quickPickStub: sinon.SinonStub;
	let withProgressStub: sinon.SinonStub;

	// Sample connection options for tests
	const mockConnections = {
		'test-connection': {
			account: TEST_ACCOUNT_NAME,
			user: 'test-user',
			warehouse: 'test-warehouse',
			database: 'test-database',
			schema: 'test-schema',
			authenticator: 'externalbrowser'
		},
		'another-connection': {
			account: 'another-account',
			user: 'another-user',
			password: 'test-password' // pragma: allowlist secret
		}
	};

	setup(function () {
		try {
			sandbox = sinon.createSandbox();

			// Create a mock extension context with editable global state
			mockGlobalState = new Map<string, any>();
			mockExtensionContext = SnowflakeMock.createMockContext(sandbox);

			Object.defineProperty(mockExtensionContext, 'globalState', {
				value: {
					get: (key: string) => mockGlobalState.get(key),
					update: (key: string, value: any) => {
						mockGlobalState.set(key, value);
						return Promise.resolve();
					},
					setKeysForSync: sandbox.stub(),
					keys: () => Array.from(mockGlobalState.keys()),
				},
				writable: true,
				configurable: true
			});

			// Setup mock for Snowflake SDK
			SnowflakeMock.setupStubs(sandbox);

			// Create a new registry for each test
			registry = new CatalogProviderRegistry();

			// Set the extension URI before registering the Snowflake provider
			setExtensionUri(mockExtensionContext);

			registerSnowflakeProvider(registry);

			// Mock getSnowflakeConnectionOptions to return our test connections
			getConnectionsStub = sandbox.stub(credentials, 'getSnowflakeConnectionOptions')
				.resolves(mockConnections);

			// Mock the showQuickPick dialog
			quickPickStub = sandbox.stub(vscode.window, 'showQuickPick');

			// Mock the withProgress function
			withProgressStub = sandbox.stub(vscode.window, 'withProgress');
			withProgressStub.callsFake(async (_options, task) => {
				return await task();
			});
		} catch (error) {
			console.error('Error in test setup:', error);
			throw error;
		}
	});

	teardown(function () {
		sandbox.restore();
	});

	test('registerSnowflakeCatalog creates provider with connection options', async () => {
		// Configure quickPick to select the test connection
		quickPickStub.resolves({ label: 'test-connection', description: 'Test connection' });

		// Call registerSnowflakeCatalog directly
		const provider = await registerSnowflakeCatalog(mockExtensionContext);

		// Verify provider was created
		assert.ok(provider);
		assert.strictEqual(provider!.id, `snowflake:${TEST_ACCOUNT_NAME}`);

		// Verify the account was saved in global state
		const savedAccounts = mockGlobalState.get(RECENT_SNOWFLAKE_ACCOUNTS_KEY);
		assert.ok(savedAccounts);
		assert.ok(savedAccounts.includes('test-connection'));
	});

	test('registerSnowflakeCatalog returns undefined when user cancels', async () => {
		// Configure quickPick to simulate user cancellation
		quickPickStub.resolves(undefined);

		// Call registerSnowflakeCatalog
		const provider = await registerSnowflakeCatalog(mockExtensionContext);

		// Verify no provider was created
		assert.strictEqual(provider, undefined);
	});

	test('registerSnowflakeCatalog uses existing connection when specified', async () => {
		// Call registerSnowflakeCatalog with explicit connection options
		const connectionOptions = mockConnections['another-connection'];
		const provider = await registerSnowflakeCatalog(mockExtensionContext, connectionOptions);

		// Verify provider was created with the right options
		assert.ok(provider);
		assert.strictEqual(provider!.id, 'snowflake:another-account');

		// Verify the account was saved in global state
		const savedAccounts = mockGlobalState.get(RECENT_SNOWFLAKE_ACCOUNTS_KEY);
		assert.ok(savedAccounts);
		assert.ok(savedAccounts.includes('another-account'));
	});

	test('getSnowflakeCatalogs returns placeholder providers for registered accounts', async () => {
		// Add a registered account to global state
		await mockExtensionContext.globalState.update(STATE_KEY_SNOWFLAKE_CONNECTIONS, ['test-connection']);

		// Import getSnowflakeCatalogs function dynamically
		const { getSnowflakeCatalogs } = require('../catalogs/snowflake');

		// Get providers
		const providers = await getSnowflakeCatalogs(mockExtensionContext);

		// Verify placeholder provider was created
		assert.strictEqual(providers.length, 1);
		assert.ok(providers[0].id.includes('snowflake'));

		// Verify the provider's tree item has correct properties
		const treeItem = providers[0].getTreeItem();
		assert.ok(treeItem.description?.includes('test-connection'));

		// Verify it has a command to authenticate
		assert.ok(treeItem.command);
		assert.strictEqual(treeItem.command.command, 'posit.catalog-explorer.addCatalogProvider');
	});

	test('getSnowflakeCatalogs returns empty array when no connections.toml found', async () => {
		// Make getSnowflakeConnectionOptions return undefined (no connections.toml)
		getConnectionsStub.resolves(undefined);

		// Import getSnowflakeCatalogs function dynamically
		const { getSnowflakeCatalogs } = require('../catalogs/snowflake');

		// Get providers
		const providers = await getSnowflakeCatalogs(mockExtensionContext);

		// Verify no providers were returned
		assert.strictEqual(providers.length, 0);
	});
});
