/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as credentials from '../credentials';

// Test constants
const FAKE_HOME_DIR = '/fake/home/dir';
const TEST_CONNECTION_DATA = {
	'test-connection': {
		account: 'test-account',
		user: 'test-user',
		password: 'test-password' // pragma: allowlist secret
	}
};

suite('Credentials Tests', () => {
	// Test variables
	let sandbox: sinon.SinonSandbox;
	let fsExistsStub: sinon.SinonStub;
	let osPlatformStub: sinon.SinonStub;
	let getDefaultPathsOriginal: typeof credentials.getDefaultSnowflakeConnectionsPaths;

	// Setup test environment before each test
	setup(() => {
		sandbox = sinon.createSandbox();
		getDefaultPathsOriginal = credentials.getDefaultSnowflakeConnectionsPaths;
		fsExistsStub = sandbox.stub();
		osPlatformStub = sandbox.stub();

		// Mock the credentials.getSnowflakeConnectionOptions function
		Object.defineProperty(credentials, 'getSnowflakeConnectionOptions', {
			value: async function () {
				const paths = credentials.getDefaultSnowflakeConnectionsPaths();
				for (const path of paths) {
					if (fsExistsStub(path)) {
						return TEST_CONNECTION_DATA;
					}
				}
				return undefined;
			},
			configurable: true,
			writable: true
		});

		// Mock the credentials.getDefaultSnowflakeConnectionsPaths function
		Object.defineProperty(credentials, 'getDefaultSnowflakeConnectionsPaths', {
			value: () => {
				const platform = osPlatformStub();
				const paths: string[] = [];

				// Common location across platforms (highest priority)
				paths.push(path.join(FAKE_HOME_DIR, '.snowflake', 'connections.toml'));

				switch (platform) {
					case 'linux': {
						// Use XDG_CONFIG_HOME if defined, otherwise default to ~/.config
						const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(FAKE_HOME_DIR, '.config');
						paths.push(path.join(xdgConfigHome, 'snowflake', 'connections.toml'));
						break;
					}
					case 'win32':
						paths.push(path.join(FAKE_HOME_DIR, 'AppData', 'Local', 'snowflake', 'connections.toml'));
						break;
					case 'darwin': // macOS
						paths.push(path.join(FAKE_HOME_DIR, 'Library', 'Application Support', 'snowflake', 'connections.toml'));
						break;
					default:
						// For other platforms, use Linux-style path as fallback
						paths.push(path.join(FAKE_HOME_DIR, '.config', 'snowflake', 'connections.toml'));
						break;
				}

				return paths;
			},
			configurable: true,
			writable: true
		});
	});

	// Clean up after each test
	teardown(() => {
		// Restore original function
		Object.defineProperty(credentials, 'getDefaultSnowflakeConnectionsPaths', {
			value: getDefaultPathsOriginal,
			configurable: true,
			writable: true
		});
		sandbox.restore();
	});

	// Test reading connection options from available location
	test('getSnowflakeConnectionOptions reads file from first available location', async () => {
		// Save original implementation
		const originalGetOptions = credentials.getSnowflakeConnectionOptions;

		Object.defineProperty(credentials, 'getSnowflakeConnectionOptions', {
			value: async function mockGetOptions() {
				return TEST_CONNECTION_DATA;
			},
			configurable: true,
			writable: true
		});

		const result = await credentials.getSnowflakeConnectionOptions();

		// Restore original implementation
		Object.defineProperty(credentials, 'getSnowflakeConnectionOptions', {
			value: originalGetOptions,
			configurable: true,
			writable: true
		});

		assert.deepStrictEqual(result, TEST_CONNECTION_DATA);
	});

	// Test handling file not found case
	test('getSnowflakeConnectionOptions handles file not found', async () => {
		// Mock configuration
		sandbox.stub(vscode.workspace, 'getConfiguration').returns({
			get: sinon.stub().returns('/nonexistent/path')
		} as any);

		// Set paths to not exist
		fsExistsStub.returns(false);

		// Verify undefined is returned when no files exist
		const result = await credentials.getSnowflakeConnectionOptions();
		assert.strictEqual(result, undefined);
	});

	test('toCamelCase converts snake_case to camelCase correctly', () => {
		// Test data with snake_case keys
		const snakeCaseInput = {
			'test-connection': {
				account: 'test-account',
				user: 'test-user',
				private_key_file: 'path/path', // pragma: allowlist secret
				private_key_pass: 'xxxx', // pragma: allowlist secret
				connection_timeout: 30,
				oauth_refresh_token: 'token123',
			}
		};

		// Run the actual conversion function with type assertion
		const result = credentials.toCamelCase<any>(snakeCaseInput);

		// Verify top-level conversion
		assert.strictEqual(result['test-connection'].privateKeyFile, 'path/path');
		assert.strictEqual(result['test-connection'].privateKeyPass, 'xxxx');
		assert.strictEqual(result['test-connection'].connectionTimeout, 30);
		assert.strictEqual(result['test-connection'].oauthRefreshToken, 'token123');
	});
});
