/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
	isValidSnowflakeAccount,
	constructSnowflakeBaseUrl,
	detectSnowflakeCredentials,
} from '../snowflakeCredentials';

suite('Snowflake Credentials', () => {

	teardown(() => {
		sinon.restore();
	});

	suite('Configuration', () => {
		// Snowflake's base URL is derived from the account identifier, never set
		// directly. Registering a baseUrl setting would let it diverge from the
		// account. Guards against anyone adding one. See issue #13750.
		test('does not contribute a Snowflake baseUrl setting', () => {
			const manifest = vscode.extensions.getExtension('positron.authentication')?.packageJSON;
			const properties = manifest?.contributes?.configuration?.properties ?? {};
			const snowflakeBaseUrlKeys = Object.keys(properties).filter(
				key => key.toLowerCase().includes('snowflake') && key.toLowerCase().includes('baseurl')
			);

			assert.deepStrictEqual(snowflakeBaseUrlKeys, []);
		});
	});

	suite('Account Validation', () => {
		test('isValidSnowflakeAccount accepts valid account formats', () => {
			// Standard org-account format
			assert.strictEqual(isValidSnowflakeAccount('myorg-myaccount'), true);
			assert.strictEqual(isValidSnowflakeAccount('posit_inc-test_account'), true);

			// Legacy account format
			assert.strictEqual(isValidSnowflakeAccount('abc12345'), true);
			assert.strictEqual(isValidSnowflakeAccount('account-123'), true);

			// Mixed case and special characters
			assert.strictEqual(isValidSnowflakeAccount('MyOrg-MyAccount'), true);
		});

		test('isValidSnowflakeAccount rejects invalid account formats', () => {
			// Empty or non-string inputs
			assert.strictEqual(isValidSnowflakeAccount(''), false);
			assert.strictEqual(isValidSnowflakeAccount(null as unknown as string), false);
			assert.strictEqual(isValidSnowflakeAccount(undefined as unknown as string), false);
			assert.strictEqual(isValidSnowflakeAccount(123 as unknown as string), false);

			// Invalid characters
			assert.strictEqual(isValidSnowflakeAccount('account@domain'), false);
			assert.strictEqual(isValidSnowflakeAccount('account with spaces'), false);
			assert.strictEqual(isValidSnowflakeAccount('account.domain.com'), false);

			// Multiple dots (should only have one for org-account format)
			assert.strictEqual(isValidSnowflakeAccount('org.sub.account'), false);
		});
	});

	suite('Base URL Construction', () => {
		test('constructSnowflakeBaseUrl builds correct URL', () => {
			assert.strictEqual(
				constructSnowflakeBaseUrl('myorg-myaccount'),
				'https://myorg-myaccount.snowflakecomputing.com/api/v2/cortex/v1'
			);
		});

		test('constructSnowflakeBaseUrl throws for invalid account', () => {
			assert.throws(
				() => constructSnowflakeBaseUrl('invalid@account'),
				/Invalid Snowflake account identifier/
			);
		});
	});

	suite('Credential Detection', () => {
		let mockWorkspaceConfig: sinon.SinonStub;
		let getConfigurationStub: sinon.SinonStub;
		let processEnvStub: sinon.SinonStub;

		setup(() => {
			mockWorkspaceConfig = sinon.stub();
			const mockConfig: vscode.WorkspaceConfiguration = {
				get: mockWorkspaceConfig,
				has: sinon.stub(),
				inspect: sinon.stub(),
				update: sinon.stub()
			};
			getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfig);
			processEnvStub = sinon.stub(process, 'env').value({});
		});

		teardown(() => {
			getConfigurationStub.restore();
			processEnvStub.restore();
		});

		test('detectSnowflakeCredentials returns undefined when SNOWFLAKE_HOME not set', async () => {
			mockWorkspaceConfig.withArgs('credentials', {}).returns({});

			const result = await detectSnowflakeCredentials();
			assert.strictEqual(result, undefined);
		});
	});
});
