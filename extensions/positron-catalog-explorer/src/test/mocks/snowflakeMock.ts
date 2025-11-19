/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import * as snowflake from 'snowflake-sdk';
import * as vscode from 'vscode';

// Constants for testing
export const RECENT_SNOWFLAKE_ACCOUNTS_KEY = 'recentSnowflakeAccounts';
export const TEST_ACCOUNT_NAME = 'test-account';
export const TEST_ACCOUNT_NAME2 = 'another-account';
export const STATE_KEY_SNOWFLAKE_CONNECTIONS = 'snowflakeConnections';

// Mock database data
export const mockDatabases = [
	{ name: 'ANALYTICS' },
	{ name: 'SALES' },
];

// Mock schema data organized by database
export const mockSchemas: Record<string, { name: string }[]> = {
	'ANALYTICS': [
		{ name: 'PUBLIC' },
		{ name: 'REPORTING' },
		{ name: 'RAW_DATA' },
	],
	'SALES': [
		{ name: 'PUBLIC' },
		{ name: 'TRANSACTIONS' },
		{ name: 'CUSTOMERS' },
	],
};

// Mock table data organized by database and schema
export const mockTables: Record<string, Record<string, { name: string }[]>> = {
	'ANALYTICS': {
		'PUBLIC': [
			{ name: 'DASHBOARD_METRICS' },
			{ name: 'USER_ANALYTICS' },
		],
		'REPORTING': [
			{ name: 'MONTHLY_REPORTS' },
			{ name: 'QUARTERLY_SUMMARY' },
		],
		'RAW_DATA': [
			{ name: 'EVENTS' },
			{ name: 'PAGE_VIEWS' },
		],
	},
	'SALES': {
		'PUBLIC': [
			{ name: 'PRODUCTS' },
		],
		'TRANSACTIONS': [
			{ name: 'ORDERS' },
			{ name: 'PAYMENTS' },
			{ name: 'REFUNDS' },
		],
		'CUSTOMERS': [
			{ name: 'CUSTOMER_PROFILES' },
			{ name: 'CUSTOMER_SEGMENTS' },
		],
	},
};

export class SnowflakeMock {
	/**
	 * Set up stubs for Snowflake SDK
	 * @param sandbox Sinon sandbox
	 * @returns Configured stubs for additional customization
	 */
	static setupStubs(sandbox: sinon.SinonSandbox) {

		const mockConnectionObj = {
			connectAsync: (callback: Function) => {
				// Successfully connect
				setTimeout(() => callback(null), 10);
				// This is needed for async/await usage
				return Promise.resolve();
			},
			execute: sandbox.stub().callsFake(({ sqlText, complete }) => {
				if (sqlText === 'SHOW DATABASES') {
					complete(null, {}, mockDatabases);
				}
				else if (sqlText.startsWith('SHOW SCHEMAS IN DATABASE')) {
					const dbMatch = sqlText.match(/SHOW SCHEMAS IN DATABASE "([^"]+)"/);
					const dbName = dbMatch ? dbMatch[1] : '';

					if (mockSchemas[dbName]) {
						complete(null, {}, mockSchemas[dbName]);
					} else {
						complete(new Error(`Database ${dbName} not found`), null, null);
					}
				}
				else if (sqlText.startsWith('SHOW TABLES IN SCHEMA')) {
					const match = sqlText.match(/SHOW TABLES IN SCHEMA "([^"]+)"."([^"]+)"/);

					if (match) {
						const dbName = match[1];
						const schemaName = match[2];

						if (mockTables[dbName] && mockTables[dbName][schemaName]) {
							complete(null, {}, mockTables[dbName][schemaName]);
						} else {
							complete(new Error(`Schema ${dbName}.${schemaName} not found`), null, null);
						}
					} else {
						complete(new Error('Invalid SQL syntax'), null, null);
					}
				}
				else {
					// Default case for any other queries
					complete(new Error('Unhandled SQL query in mock'), null, null);
				}
			}),
			destroy: sandbox.stub().callsFake((callback) => {
				setTimeout(() => callback(null), 10);
			}),
			connect: sandbox.stub().callsFake((callback) => callback(null)),
		};

		// Use a type assertion to convert to snowflake.Connection
		const mockConnection = mockConnectionObj as unknown as snowflake.Connection;

		const mockSnowflakeModule = {
			...snowflake, // Preserve other exports
			createConnection: () => mockConnection,
			configure: sandbox.stub().returns(undefined)
		};

		// Mock module instead of stubbing a single method
		const requireCache = require.cache[require.resolve('snowflake-sdk')];
		if (requireCache) {
			requireCache.exports = mockSnowflakeModule;
			sandbox.stub(requireCache, 'exports').value(mockSnowflakeModule);
		}
		return {
			mockConnection,
			mockSnowflakeModule
		};
	}

	/**
	 * Create a mock Extension Context for testing
	 * @param recentAccounts Optional array of recent accounts to initialize in globalState
	 * @returns A mock vscode.ExtensionContext
	 */
	static createMockContext(sandbox: sinon.SinonSandbox, recentAccounts?: string[]) {
		const mockState = new Map<string, any>();

		if (recentAccounts) {
			mockState.set(RECENT_SNOWFLAKE_ACCOUNTS_KEY, recentAccounts);
		}

		const mockContext: Partial<vscode.ExtensionContext> = {
			subscriptions: [],
			extensionUri: vscode.Uri.parse('file:///mock-extension'),
			extensionPath: '/mock-extension',
			storagePath: '/mock-storage',
			globalState: {
				get: (key: string) => mockState.get(key),
				update: (key: string, value: any) => {
					mockState.set(key, value);
					return Promise.resolve();
				},
				setKeysForSync: sandbox.stub(),
				keys: () => Array.from(mockState.keys()),
			},
		};

		return mockContext as vscode.ExtensionContext;
	}
}
