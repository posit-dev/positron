/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getModelProviders } from './providers';
import { PROVIDER_ENABLE_SETTINGS_SEARCH } from './constants.js';

/**
 * Register all available language model providers. Supported providers may or may not
 * be enabled based on user configuration.
 * Should be called once during extension activation.
 */
export function registerSupportedProviders(): void {
	const registeredProviderIds: string[] = [];

	// Register all providers defined in the Positron Assistant extension
	const models = getModelProviders();
	for (const model of models) {
		if (model.source?.provider) {
			registeredProviderIds.push(model.source.provider.id);

			positron.ai.registerProviderMetadata({
				id: model.source.provider.id,
				displayName: model.source.provider.displayName,
				settingName: model.source.provider.settingName
			});
		}
	}

	// TODO: For future consideration, how can providers from other extensions be dynamically
	// discovered and registered here? Perhaps an extension API to register a provider?
	// For now, we only support providers that are returned by getModelProviders().
}

/**
 * Validates that at least one language model provider is enabled.
 * If no providers are enabled, shows a warning message with an option to open settings.
 */
export async function validateProvidersEnabled(): Promise<void> {
	const enabledProviders = await positron.ai.getEnabledProviders();
	if (enabledProviders.length === 0) {
		const openSettings = vscode.l10n.t('Open Settings');
		const selection = await vscode.window.showWarningMessage(
			vscode.l10n.t(
				'No language model providers are enabled for Positron Assistant. Please enable at least one provider in the settings.'
			),
			openSettings
		);
		if (selection === openSettings) {
			await vscode.commands.executeCommand('workbench.action.openSettings', PROVIDER_ENABLE_SETTINGS_SEARCH);
		}
	}
}
