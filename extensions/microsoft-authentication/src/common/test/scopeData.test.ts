/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ScopeData } from '../scopeData';

suite('ScopeData', () => {
	test('should include default scopes if not present', () => {
		const scopeData = new ScopeData(['custom_scope']);
		assert.deepStrictEqual(scopeData.allScopes, ['custom_scope', 'email', 'offline_access', 'openid', 'profile']);
	});

	test('should not duplicate default scopes if already present', () => {
		const scopeData = new ScopeData(['openid', 'email', 'profile', 'offline_access']);
		assert.deepStrictEqual(scopeData.allScopes, ['email', 'offline_access', 'openid', 'profile']);
	});

	test('should sort the scopes alphabetically', () => {
		const scopeData = new ScopeData(['profile', 'email', 'openid', 'offline_access']);
		assert.deepStrictEqual(scopeData.allScopes, ['email', 'offline_access', 'openid', 'profile']);
	});

	test('should create a space-separated string of all scopes', () => {
		const scopeData = new ScopeData(['custom_scope']);
		assert.strictEqual(scopeData.scopeStr, 'custom_scope email offline_access openid profile');
	});

	test('should filter out internal VS Code scopes for scopesToSend', () => {
		const scopeData = new ScopeData(['custom_scope', 'VSCODE_CLIENT_ID:some_id']);
		assert.deepStrictEqual(scopeData.scopesToSend, ['custom_scope']);
	});

	test('should use the default client ID if no VSCODE_CLIENT_ID scope is present', () => {
		const scopeData = new ScopeData(['custom_scope']);
		assert.strictEqual(scopeData.clientId, 'aebc6443-996d-45c2-90f0-388ff96faa56');
	});

	test('should use the VSCODE_CLIENT_ID scope if present', () => {
		const scopeData = new ScopeData(['custom_scope', 'VSCODE_CLIENT_ID:some_id']);
		assert.strictEqual(scopeData.clientId, 'some_id');
	});

	test('should use the default tenant ID if no VSCODE_TENANT scope is present', () => {
		const scopeData = new ScopeData(['custom_scope']);
		assert.strictEqual(scopeData.tenant, 'organizations');
	});

	test('should use the VSCODE_TENANT scope if present', () => {
		const scopeData = new ScopeData(['custom_scope', 'VSCODE_TENANT:some_tenant']);
		assert.strictEqual(scopeData.tenant, 'some_tenant');
	});
});
