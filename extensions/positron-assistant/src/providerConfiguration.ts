/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getModelProviders } from './providers';
import { log } from './extension.js';
import { configureProvider, uiNameToProviderId } from './providerMapping.js';
import { PROVIDER_ENABLE_SETTINGS_SEARCH } from './constants.js';

/**
 * Cached set of supported provider IDs.
 * Populated during registerSupportedProviders() to include all registered providers.
 */
let supportedProviderIds: Set<string> | undefined;

/**
 * Validates a list of provider identifiers (either UI names or provider IDs) and returns
 * valid provider IDs. Logs warnings and optionally shows user notifications for unsupported identifiers.
 *
 * @param identifiers - Array of provider UI names or provider IDs to validate
 * @param settingName - Name of the setting for error messages
 * @param showWarningMessage - Whether to show a user-facing warning message (default: true)
 * @returns Array of valid provider IDs
 */
export function validateProviders(
	identifiers: string[],
	settingName: string,
	showWarningMessage = true
): string[] {
	if (!supportedProviderIds) {
		throw new Error('validateProviders() called before registerSupportedProviders(). Could not determine supported providers.');
	}

	const valid: string[] = [];
	const unsupported: string[] = [];

	for (const identifier of identifiers) {
		const providerId = uiNameToProviderId(identifier);
		const normalizedId = providerId || identifier;

		if (supportedProviderIds.has(normalizedId)) {
			valid.push(normalizedId);
		} else {
			unsupported.push(identifier);
		}
	}

	// Warn about unsupported identifiers
	if (unsupported.length > 0) {
		log.warn(
			`[Positron Assistant] Unsupported providers in ${settingName}: ${unsupported.join(', ')}`
		);
		if (showWarningMessage) {
			vscode.window.showWarningMessage(
				vscode.l10n.t(
					'Some providers in {0} are not supported and will be ignored: {1}',
					settingName,
					unsupported.join(', ')
				)
			);
		}
	}

	return valid;
}

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
			// Register display name mapping for models.preference.byProvider and models.custom settings
			configureProvider(model.source.provider.id, model.source.provider.displayName);
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

	// Cache the registered provider IDs for validation
	supportedProviderIds = new Set(registeredProviderIds);
}

/**
 * Validates that provider keys in models.preference.byProvider are supported.
 * Logs warnings for any unsupported provider keys found (does not show user notification).
 */
export function validateByProviderPreferences(): void {
	const config = vscode.workspace.getConfiguration('positron.assistant');
	const byProviderPreferences = config.get<Record<string, string>>('models.preference.byProvider') || {};
	const providerKeys = Object.keys(byProviderPreferences);

	if (providerKeys.length === 0) {
		return;
	}

	// Validate the provider keys (can be UI names or provider IDs)
	// Only log warnings, don't show user-facing notification
	validateProviders(providerKeys, 'positron.assistant.models.preference.byProvider', false);
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
