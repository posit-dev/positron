/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { CatalogProviderRegistry } from '../catalog';
import { registerSnowflakeProvider } from '../catalogs/snowflake';
import { setExtensionUri } from '../resources';
import {
	SnowflakeMock,

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

});
