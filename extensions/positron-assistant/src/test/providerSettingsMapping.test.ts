/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as providersModule from '../providers';

/**
 * Tests that validate real provider definitions.
 * These tests use actual provider data (no mocks) to catch issues when new providers are added.
 */
suite('Provider Settings Mapping', () => {
	// Test providers that are intentionally not in package.json
	const testProviderIds = ['echo', 'error'];

	test('providers have correct package.json setting presence', () => {
		const providers = providersModule.getModelProviders();
		const config = vscode.workspace.getConfiguration('positron.assistant');

		for (const provider of providers) {
			const settingName = provider.source.provider.settingName;
			const providerId = provider.source.provider.id;

			if (!settingName) {
				continue;
			}

			const settingKey = `provider.${settingName}.enable`;
			const inspection = config.inspect<boolean>(settingKey);
			const hasPackageJsonSetting = inspection?.defaultValue !== undefined;
			const isTestProvider = testProviderIds.includes(providerId);

			if (isTestProvider) {
				assert.ok(
					!hasPackageJsonSetting,
					`Test provider '${providerId}' should not have a package.json setting but 'positron.assistant.${settingKey}' exists`
				);
			} else {
				assert.ok(
					hasPackageJsonSetting,
					`Provider '${providerId}' has settingName '${settingName}' but 'positron.assistant.${settingKey}' is not defined in package.json`
				);
			}
		}
	});

	test('settingName values are unique across providers', () => {
		const providers = providersModule.getModelProviders();
		const settingNameToProvider = new Map<string, string>();
		const duplicates: string[] = [];

		for (const provider of providers) {
			const settingName = provider.source.provider.settingName;
			const providerId = provider.source.provider.id;

			if (settingName) {
				const existingProvider = settingNameToProvider.get(settingName);
				if (existingProvider) {
					duplicates.push(`'${settingName}' used by both '${existingProvider}' and '${providerId}'`);
				}
				settingNameToProvider.set(settingName, providerId);
			}
		}

		assert.strictEqual(duplicates.length, 0, `Duplicate settingNames found: ${duplicates.join(', ')}`);
	});
});
