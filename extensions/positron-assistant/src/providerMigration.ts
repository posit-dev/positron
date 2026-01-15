/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { log } from './extension.js';
import { getModelProviders } from './providers/index.js';

/**
 * Gets a map of provider ID to setting name from the provider source metadata.
 *
 * @returns Map of provider ID (e.g., "anthropic-api") to setting name (e.g., "anthropic")
 */
export function getProviderIdToSettingNameMap(): Map<string, string> {
	const providers = getModelProviders();
	const map = new Map<string, string>();

	for (const providerClass of providers) {
		const providerId = providerClass.source.provider.id;
		const settingName = providerClass.source.provider.settingName;

		if (settingName) {
			map.set(providerId, settingName);
		}
	}

	return map;
}

/**
 * Performs one-time migration from positron.assistant.enabledProviders
 * to the new individual settings-based system.
 *
 * This migrates from:
 * - positron.assistant.enabledProviders (array)
 *
 * To:
 * - positron.assistant.provider.<name>.enable (individual boolean settings)
 *
 * Migration strategy:
 * 1. Read old enabledProviders array
 * 2. For each enabled provider, set the corresponding individual setting
 * 3. Don't overwrite existing individual settings (preserve user choice)
 * 4. Remove the old setting after migration
 * 5. Show notification when migration occurs
 */
export async function performProviderMigration(): Promise<void> {
	const config = vscode.workspace.getConfiguration('positron.assistant');

	// Inspect the old setting to determine its scope
	const enabledProvidersInspect = config.inspect<string[]>('enabledProviders');

	// Determine which scope to migrate and get the values from that scope
	let targetScope: vscode.ConfigurationTarget;
	let legacyEnabledProviders: string[] | undefined;

	// Check workspace scope first
	const hasWorkspaceEnabledProviders = enabledProvidersInspect?.workspaceValue && enabledProvidersInspect.workspaceValue.length > 0;

	// Check global scope
	const hasGlobalEnabledProviders = enabledProvidersInspect?.globalValue && enabledProvidersInspect.globalValue.length > 0;

	if (hasWorkspaceEnabledProviders) {
		// Migrate workspace settings to workspace scope
		targetScope = vscode.ConfigurationTarget.Workspace;
		legacyEnabledProviders = enabledProvidersInspect?.workspaceValue;
	} else if (hasGlobalEnabledProviders) {
		// Migrate global settings to global scope
		targetScope = vscode.ConfigurationTarget.Global;
		legacyEnabledProviders = enabledProvidersInspect?.globalValue;
	} else {
		// No settings to migrate
		return;
	}

	try {
		// Log the existing configuration for backup purposes
		const scopeName = targetScope === vscode.ConfigurationTarget.Workspace ? 'workspace' : 'global';
		if (legacyEnabledProviders) {
			log.info(`[performProviderMigration] enabledProviders array detected in ${scopeName} settings: ${JSON.stringify(legacyEnabledProviders)}`);
		}

		// Get provider ID to setting name map
		const providerIdToSettingName = getProviderIdToSettingNameMap();

		// Collect all enabled providers from the old setting
		const enabledProviders = new Set<string>();

		// Add from enabledProviders array (provider IDs)
		if (legacyEnabledProviders) {
			for (const providerId of legacyEnabledProviders) {
				const settingName = providerIdToSettingName.get(providerId);
				if (settingName) {
					enabledProviders.add(settingName);
				} else {
					log.warn(`[performProviderMigration] Unknown provider ID in enabledProviders: ${providerId}`);
				}
			}
		}

		// Migrate to individual settings (don't overwrite existing settings)
		let migratedCount = 0;
		for (const settingName of enabledProviders) {
			const settingKey = `provider.${settingName}.enable`;
			const existingValue = config.inspect<boolean>(settingKey);

			// Only set if not already set by user
			const isAlreadySet = targetScope === vscode.ConfigurationTarget.Workspace
				? existingValue?.workspaceValue !== undefined
				: existingValue?.globalValue !== undefined;

			if (!isAlreadySet) {
				try {
					await config.update(settingKey, true, targetScope);
					migratedCount++;
					log.info(`[performProviderMigration] Migrated provider to ${scopeName} setting: positron.assistant.${settingKey} = true`);
				} catch (error) {
					// If the setting cannot be written, log but don't fail the migration
					log.warn(`[performProviderMigration] Could not migrate setting for provider '${settingName}': positron.assistant.${settingKey}. The provider may need to be manually enabled.`);
				}
			}
		}

		// Remove old setting after migration
		if (legacyEnabledProviders) {
			await config.update('enabledProviders', undefined, targetScope);
			log.info(`[performProviderMigration] Removed positron.assistant.enabledProviders setting from ${scopeName}`);
		}

		// Show migration notification
		if (migratedCount > 0) {
			vscode.window.showInformationMessage(
				vscode.l10n.t('The \'positron.assistant.enabledProviders\' setting has been deprecated, and has been migrated to individual settings for each provider. You can search for these settings in the Settings UI with "positron.assistant.provider enable". Please remove your \'positron.assistant.enabledProviders\' setting, which will be phased out in an upcoming release.')
			);
		}
	} catch (error) {
		log.error(`[performProviderMigration] Failed to perform provider migration: ${JSON.stringify(error, null, 2)}`);
		vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to migrate provider configuration: {0}', JSON.stringify(error))
		);
	}
}
