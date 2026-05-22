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
	getSnowflakeDefaultBaseUrl,
	getSnowflakePartnerTag,
	seedSnowflakePartnerTagHeader,
	detectSnowflakeCredentials,
} from '../snowflakeCredentials';

suite('Snowflake Credentials', () => {

	teardown(() => {
		sinon.restore();
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

	suite('Default Base URL', () => {
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

		test('getSnowflakeDefaultBaseUrl uses account from configuration', () => {
			mockWorkspaceConfig.withArgs('credentials', {}).returns({ SNOWFLAKE_ACCOUNT: 'config-account' });

			const url = getSnowflakeDefaultBaseUrl();
			assert.strictEqual(url, 'https://config-account.snowflakecomputing.com/api/v2/cortex/v1');
		});

		test('getSnowflakeDefaultBaseUrl uses account from environment', () => {
			mockWorkspaceConfig.withArgs('credentials', {}).returns({});
			processEnvStub.value({ SNOWFLAKE_ACCOUNT: 'env-account' });

			const url = getSnowflakeDefaultBaseUrl();
			assert.strictEqual(url, 'https://env-account.snowflakecomputing.com/api/v2/cortex/v1');
		});

		test('getSnowflakeDefaultBaseUrl falls back to placeholder when no account available', () => {
			mockWorkspaceConfig.withArgs('credentials', {}).returns({});

			const url = getSnowflakeDefaultBaseUrl();
			assert.strictEqual(url, 'https://<account_identifier>.snowflakecomputing.com/api/v2/cortex/v1');
		});

		test('getSnowflakeDefaultBaseUrl falls back to placeholder for invalid account', () => {
			mockWorkspaceConfig.withArgs('credentials', {}).returns({ SNOWFLAKE_ACCOUNT: 'invalid@account' });

			const url = getSnowflakeDefaultBaseUrl();
			assert.strictEqual(url, 'https://<account_identifier>.snowflakecomputing.com/api/v2/cortex/v1');
		});
	});

	suite('Partner Tag', () => {
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

		test('getSnowflakePartnerTag prefers environmentVariables.set.SF_PARTNER', () => {
			mockWorkspaceConfig.withArgs('set').returns({ SF_PARTNER: 'setting_value' });
			processEnvStub.value({ SF_PARTNER: 'env_value' });

			assert.strictEqual(getSnowflakePartnerTag(), 'setting_value');
		});

		test('getSnowflakePartnerTag falls back to process.env.SF_PARTNER', () => {
			mockWorkspaceConfig.withArgs('set').returns({});
			processEnvStub.value({ SF_PARTNER: 'env_value' });

			assert.strictEqual(getSnowflakePartnerTag(), 'env_value');
		});

		test('getSnowflakePartnerTag defaults to posit_positron', () => {
			mockWorkspaceConfig.withArgs('set').returns({});

			assert.strictEqual(getSnowflakePartnerTag(), 'posit_positron');
		});
	});

	suite('Seed Partner Tag Header', () => {
		let getStub: sinon.SinonStub;
		let inspectStub: sinon.SinonStub;
		let updateStub: sinon.SinonStub;
		let getConfigurationStub: sinon.SinonStub;

		setup(() => {
			getStub = sinon.stub();
			inspectStub = sinon.stub();
			updateStub = sinon.stub().resolves();
			const mockConfig: vscode.WorkspaceConfiguration = {
				get: getStub,
				has: sinon.stub(),
				inspect: inspectStub,
				update: updateStub,
			};
			getConfigurationStub = sinon
				.stub(vscode.workspace, 'getConfiguration')
				.callsFake((section?: string) => {
					if (section === 'authentication.snowflake') {
						return mockConfig;
					}
					// Empty config for SF_PARTNER lookup so the seeded
					// User-Agent is always the default partner tag.
					return { get: () => ({}) } as unknown as vscode.WorkspaceConfiguration;
				});
			sinon.stub(process, 'env').value({});
		});

		teardown(() => {
			getConfigurationStub.restore();
		});

		test('skips write when User-Agent is already set in effective config', async () => {
			getStub.withArgs('customHeaders', {}).returns({ 'User-Agent': 'user-custom' });
			inspectStub.withArgs('customHeaders').returns({ globalValue: { 'User-Agent': 'user-custom' } });

			const wrote = await seedSnowflakePartnerTagHeader();

			assert.strictEqual(wrote, false);
			assert.strictEqual(updateStub.called, false);
		});

		test('writes to most-specific scope where customHeaders is defined, merging existing keys', async () => {
			getStub.withArgs('customHeaders', {}).returns({ 'X-Tenant': 'acme' });
			inspectStub.withArgs('customHeaders').returns({
				globalValue: { 'X-Global': 'g' },
				workspaceValue: { 'X-Tenant': 'acme' },
			});

			const wrote = await seedSnowflakePartnerTagHeader();

			assert.strictEqual(wrote, true);
			assert.deepStrictEqual(updateStub.firstCall.args, [
				'customHeaders',
				{ 'X-Tenant': 'acme', 'User-Agent': 'posit_positron' },
				vscode.ConfigurationTarget.Workspace,
			]);
		});

		test('falls back to Global when customHeaders is not defined at any scope', async () => {
			getStub.withArgs('customHeaders', {}).returns({});
			inspectStub.withArgs('customHeaders').returns({});

			const wrote = await seedSnowflakePartnerTagHeader();

			assert.strictEqual(wrote, true);
			assert.deepStrictEqual(updateStub.firstCall.args, [
				'customHeaders',
				{ 'User-Agent': 'posit_positron' },
				vscode.ConfigurationTarget.Global,
			]);
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
