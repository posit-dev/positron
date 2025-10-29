/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { CatalogProviderRegistry } from '../catalog';
import { registerSnowflakeProvider, saveRecentAccount, getSnowflakeCatalogs, registration, registerSnowflakeCatalog } from '../catalogs/snowflake';
import { setExtensionUri } from '../resources';
import {
	SnowflakeMock,
	RECENT_SNOWFLAKE_ACCOUNTS_KEY,
	TEST_ACCOUNT_NAME,
	TEST_ACCOUNT_NAME2
} from './mocks/snowflakeMock';

suite('Snowflake Catalog Provider Tests', () => {
	let sandbox: sinon.SinonSandbox;
	let registry: CatalogProviderRegistry;
	let mockExtensionContext: vscode.ExtensionContext;
	let mockGlobalState: Map<string, any>;

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

			SnowflakeMock.setupStubs(sandbox);

			// Create a new registry for each test
			registry = new CatalogProviderRegistry();

			// Set the extension URI before registering the Snowflake provider
			setExtensionUri(mockExtensionContext);

			registerSnowflakeProvider(registry);
		} catch (error) {
			console.error('Error in test setup:', error);
			throw error;
		}
	});

	teardown(function () {
		sandbox.restore();
	});

	/**
	 * Helper to set up the extension with no recent accounts
	 */
	function setupWithNoRecentAccounts() {
		mockGlobalState.delete(RECENT_SNOWFLAKE_ACCOUNTS_KEY);
	}

	/**
	 * Helper to set up the extension with some recent accounts
	 */
	function setupWithRecentAccounts(accounts: string[] = [TEST_ACCOUNT_NAME, TEST_ACCOUNT_NAME2]) {
		mockGlobalState.set(RECENT_SNOWFLAKE_ACCOUNTS_KEY, accounts);
	}

	test('saveRecentAccount adds account to empty recent list', async function () {
		setupWithNoRecentAccounts();

		await saveRecentAccount(mockExtensionContext, TEST_ACCOUNT_NAME);

		// Check if account was saved properly
		const savedAccounts = mockGlobalState.get(RECENT_SNOWFLAKE_ACCOUNTS_KEY);
		assert.strictEqual(Array.isArray(savedAccounts), true, 'Should save as array');
		assert.strictEqual(savedAccounts.length, 1, 'Should contain one account');
		assert.strictEqual(savedAccounts[0], TEST_ACCOUNT_NAME, 'Should save correct account name');
	});

	test('saveRecentAccount adds new account to beginning of existing list', async function () {
		setupWithRecentAccounts([TEST_ACCOUNT_NAME2]);

		saveRecentAccount(mockExtensionContext, TEST_ACCOUNT_NAME);

		// Check if account was saved properly at the beginning
		const savedAccounts = mockGlobalState.get(RECENT_SNOWFLAKE_ACCOUNTS_KEY);
		assert.strictEqual(savedAccounts.length, 2, 'Should contain two accounts');
		assert.strictEqual(savedAccounts[0], TEST_ACCOUNT_NAME, 'New account should be first');
		assert.strictEqual(savedAccounts[1], TEST_ACCOUNT_NAME2, 'Old account should be second');
	});

	test('saveRecentAccount moves existing account to beginning of list', async function () {
		setupWithRecentAccounts([TEST_ACCOUNT_NAME2, TEST_ACCOUNT_NAME]);

		await saveRecentAccount(mockExtensionContext, TEST_ACCOUNT_NAME);

		// Check if account was moved to the beginning
		const savedAccounts = mockGlobalState.get(RECENT_SNOWFLAKE_ACCOUNTS_KEY);
		assert.strictEqual(savedAccounts.length, 2, 'Should still contain two accounts');
		assert.strictEqual(savedAccounts[0], TEST_ACCOUNT_NAME, 'Used account should be first');
		assert.strictEqual(savedAccounts[1], TEST_ACCOUNT_NAME2, 'Other account should be second');
	});

	test('saveRecentAccount does not create duplicates', async function () {
		setupWithRecentAccounts([TEST_ACCOUNT_NAME, TEST_ACCOUNT_NAME2]);

		await saveRecentAccount(mockExtensionContext, TEST_ACCOUNT_NAME);

		// Check that no duplicates were created
		const savedAccounts = mockGlobalState.get(RECENT_SNOWFLAKE_ACCOUNTS_KEY);
		assert.strictEqual(savedAccounts.length, 2, 'Should still contain two accounts');
		assert.strictEqual(savedAccounts.filter((a: string) => a === TEST_ACCOUNT_NAME).length, 1,
			'TEST_ACCOUNT_NAME should appear exactly once');
	});

	test('getSnowflakeCatalogs returns placeholder providers for recent accounts', async function () {
		setupWithRecentAccounts([TEST_ACCOUNT_NAME, TEST_ACCOUNT_NAME2]);

		const providers = await getSnowflakeCatalogs(mockExtensionContext);

		// Verify correct number of providers
		assert.strictEqual(providers.length, 2, 'Should return two placeholder providers');

		// Verify provider properties
		const provider1 = providers[0];
		assert.strictEqual(provider1.id, `snowflake:${TEST_ACCOUNT_NAME}`, 'Provider ID should include account name');

		// Verify tree item
		const treeItem1 = provider1.getTreeItem();
		assert.strictEqual(treeItem1.description, TEST_ACCOUNT_NAME, 'Tree item should show account name');
		assert.strictEqual(treeItem1.contextValue, 'provider:snowflake:placeholder',
			'Context value should be placeholder');
		assert.ok(treeItem1.command, 'Tree item should have a command');
		assert.strictEqual(treeItem1.command?.command, 'posit.catalog-explorer.addCatalogProvider',
			'Command should be add catalog provider');
	});

	test('removeProvider removes account from recent accounts list', async function () {
		setupWithRecentAccounts([TEST_ACCOUNT_NAME, TEST_ACCOUNT_NAME2]);
		const providers = await getSnowflakeCatalogs(mockExtensionContext);

		// Call removeProvider on the first provider
		assert.ok(registration.removeProvider, 'removeProvider should be defined');
		await registration.removeProvider(mockExtensionContext, providers[0]);

		// Check that the account was removed from recent accounts
		const recentAccounts = mockGlobalState.get(RECENT_SNOWFLAKE_ACCOUNTS_KEY);
		assert.strictEqual(recentAccounts.length, 1, 'Should have removed one account');
		assert.strictEqual(recentAccounts[0], TEST_ACCOUNT_NAME2, 'Should have removed the correct account');
	});

	test('registerSnowflakeCatalog with no seeded account shows quickpick with recent accounts', async function () {
		setupWithRecentAccounts();

		// Create a stub for showQuickPick specific to this test
		const showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick').callsFake((items: any, _options?: any) => {
			// Check that quickpick items include recent accounts
			if (Array.isArray(items)) {
				assert.strictEqual(items.length, 3, 'Should show two recent accounts plus "Enter New Account"');
				assert.strictEqual(items[0].label, TEST_ACCOUNT_NAME, 'First item should be TEST_ACCOUNT_NAME');
				assert.strictEqual(items[1].label, TEST_ACCOUNT_NAME2, 'Second item should be TEST_ACCOUNT_NAME2');
				assert.strictEqual(items[2].label, 'Enter New Account...', 'Should have "Enter New Account" option');

				// Return the first item to simulate selection
				return Promise.resolve(items[0]);
			}
			return Promise.resolve(undefined);
		});

		sandbox.stub(vscode.window, 'withProgress').callsFake((_options: any, task: any) => task());

		await registerSnowflakeCatalog(mockExtensionContext);

		// Verify showQuickPick was called
		assert.strictEqual(showQuickPickStub.callCount, 1, 'showQuickPick should be called once');
	});

	test('registerSnowflakeCatalog with no recent accounts shows input box', async function () {
		setupWithNoRecentAccounts();

		// Create stubs for VS Code APIs specific to this test
		const showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
		const showInputBoxStub = sandbox.stub(vscode.window, 'showInputBox').resolves(TEST_ACCOUNT_NAME);
		sandbox.stub(vscode.window, 'withProgress').callsFake((_options: any, task: any) => task());

		await registerSnowflakeCatalog(mockExtensionContext);

		// Verify showQuickPick was NOT called (since there are no recent accounts)
		assert.strictEqual(showQuickPickStub.callCount, 0, 'showQuickPick should not be called');

		// Verify showInputBox was called to get the account name
		assert.strictEqual(showInputBoxStub.callCount, 1, 'showInputBox should be called once');
	});

});
