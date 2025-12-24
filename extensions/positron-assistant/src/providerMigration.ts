/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { providerIdToUiName } from './providerMapping.js';
import { log } from './extension.js';

/**
 * Performs one-time migration from the old array-based enabledProviders configuration
 * to the new object-based providers configuration.
 *
 * This function is non-blocking and returns immediately after showing the migration prompt.
 * The actual migration happens asynchronously after user confirmation.
 *
 * This function:
 * 1. Checks if migration is needed (old enabledProviders array is set)
 * 2. Shows a non-blocking warning notification with a preview of what will change
 * 3. If user approves, asynchronously maps provider IDs from the old array to UI names in the new object
 * 4. Removes the old setting after successful migration
 * 5. Shows success notification with option to open settings
 */
export async function performProviderMigration(): Promise<void> {
	const config = vscode.workspace.getConfiguration('positron.assistant');
	const legacyEnabledProviders = config.get<string[]>('enabledProviders');

	if (!legacyEnabledProviders || legacyEnabledProviders.length === 0) {
		return; // Nothing to migrate
	}

	try {
		// Log the existing configuration for backup purposes
		log.info(`[performProviderMigration] Deprecated positron.assistant.enabledProviders setting detected. Current enabledProviders: ${JSON.stringify(legacyEnabledProviders)}. Please migrate to the positron.assistant.providers setting.`);

		// Build preview of what will change
		const mappedProviders: Array<{ id: string; uiName: string }> = [];
		const unsupportedProviders: string[] = [];

		for (const providerId of legacyEnabledProviders) {
			const uiName = providerIdToUiName(providerId);
			if (uiName) {
				mappedProviders.push({ id: providerId, uiName });
			} else {
				unsupportedProviders.push(providerId);
			}
		}

		// Build preview message
		let previewMessage = vscode.l10n.t(
			'The positron.assistant.enabledProviders setting is deprecated and will be replaced. ' +
			'Click "Migrate Now" to move your enabled providers to positron.assistant.providers and remove the old setting. '
		);

		if (mappedProviders.length > 0) {
			const providerNames = mappedProviders.map(p => p.uiName).join(', ');
			previewMessage += vscode.l10n.t('Providers to migrate: {0}. ', providerNames);
		}

		if (unsupportedProviders.length > 0) {
			previewMessage += vscode.l10n.t('(Providers no longer supported: {0}) ', unsupportedProviders.join(', '));
		}

		// Show migration warning notification (non-blocking)
		const migrateNow = vscode.l10n.t('Migrate Now');
		const notNow = vscode.l10n.t('Not Now');
		return vscode.window.showWarningMessage(
			previewMessage,
			migrateNow,
			notNow
		).then(async (choice) => {
			if (choice !== migrateNow) {
				log.info('[performProviderMigration] Provider migration declined. Will prompt again on next extension activation.');
				return;
			}

			try {
				// Build new providers configuration
				const newProvidersConfig: Record<string, boolean> = {};
				for (const provider of mappedProviders) {
					newProvidersConfig[provider.uiName] = true;
				}

				// Log any unsupported providers that are being removed
				if (unsupportedProviders.length > 0) {
					log.debug(`[performProviderMigration] Removing unsupported providers during migration: ${unsupportedProviders.join(', ')}`);
				}

				// Update the new providers configuration (merge with existing if present)
				await config.update('providers', newProvidersConfig, vscode.ConfigurationTarget.Global);

				// Remove the old array configuration completely
				await config.update('enabledProviders', undefined, vscode.ConfigurationTarget.Global);

				// Show success notification with button to open settings (non-blocking)
				const openSettings = vscode.l10n.t('Open Settings');
				vscode.window.showInformationMessage(
					vscode.l10n.t('Assistant provider settings updated successfully'),
					openSettings
				).then((result) => {
					if (result === openSettings) {
						vscode.commands.executeCommand('workbench.action.openSettings', 'positron.assistant.providers');
					}
				});

				log.info('[performProviderMigration] Provider migration completed successfully');
			} catch (error) {
				log.error(`[performProviderMigration] Failed to apply migration: ${JSON.stringify(error, null, 2)}`);
				vscode.window.showErrorMessage(
					vscode.l10n.t('Failed to migrate provider configuration: {0}', JSON.stringify(error))
				);
			}
		});
	} catch (error) {
		log.error(`[performProviderMigration] Failed to prepare provider migration: ${JSON.stringify(error, null, 2)}`);
		vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to prepare provider migration: {0}', JSON.stringify(error))
		);
	}
}
