/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { log } from './extension.js';
import { getModelProviders } from './providers/index.js';
import { PROVIDER_ENABLE_SETTINGS_SEARCH } from './constants.js';

export function getProviderIdToSettingNameMap(): Map<string, string> {
	const map = new Map<string, string>();
	for (const provider of getModelProviders()) {
		const { id, settingName } = provider.source.provider;
		if (settingName) {
			map.set(id, settingName);
		}
	}
	return map;
}

export async function performSettingsMigrations(): Promise<void> {
	await Promise.all([
		performProviderMigration(),
		performModelPreferencesMigration(),
		performCustomModelsMigration()
	]);
}

function showMigrationNotification(
	config: vscode.WorkspaceConfiguration,
	hideNotificationKey: string,
	message: string,
	settingsSearchQuery: string
) {
	if (config.get<boolean>(hideNotificationKey, false)) {
		return;
	}

	const showSettings = vscode.l10n.t('Show Settings');
	const dontShowAgain = vscode.l10n.t(`Don't Show Again`);

	vscode.window.showInformationMessage(message, showSettings, dontShowAgain).then(selection => {
		if (selection === showSettings) {
			vscode.commands.executeCommand('workbench.action.openSettings', settingsSearchQuery);
		} else if (selection === dontShowAgain) {
			config.update(hideNotificationKey, true, vscode.ConfigurationTarget.Global);
		}
	});
}

/**
 * Migrates settings from an old key format to new per-provider keys.
 *
 * The old setting always takes precedence: if a value exists in the old setting,
 * it will overwrite any existing value in the corresponding new per-provider setting.
 * After migration, the old setting is removed.
 *
 * @param oldKey - The old setting key (e.g., 'models.custom')
 * @param newKeyTemplate - Template for new keys with {name} placeholder (e.g., 'models.overrides.{name}')
 * @param notificationKey - Setting key to track if user dismissed the notification
 * @param notificationMessage - Message to show user after migration
 * @param searchQuery - Settings search query for the "Show Settings" action
 * @param processValue - Optional function to transform values before migration
 */
async function migrateSettings<T>(
	oldKey: string,
	newKeyTemplate: string,
	notificationKey: string,
	notificationMessage: string,
	searchQuery: string,
	processValue?: (providerId: string, value: T) => T | null
): Promise<void> {
	const config = vscode.workspace.getConfiguration('positron.assistant');
	const oldValue = config.inspect<Record<string, T> | string[]>(oldKey)?.globalValue;

	if (!oldValue || (Array.isArray(oldValue) ? oldValue.length === 0 : Object.keys(oldValue).length === 0)) {
		return;
	}

	const migrationName = oldKey.replace(/\./g, '_');
	log.info(`[${migrationName}] Migrating from global settings`);

	try {
		const providerMap = getProviderIdToSettingNameMap();
		const entries: Array<[string, T]> = Array.isArray(oldValue)
			? oldValue.map(id => [id, true as T])
			: Object.entries(oldValue) as Array<[string, T]>;

		for (const [providerId, value] of entries) {
			const settingName = providerMap.get(providerId);
			if (!settingName) {
				log.warn(`[${migrationName}] Unknown provider ID: ${providerId}`);
				continue;
			}

			const processedValue = processValue ? processValue(providerId, value) : value;
			if (processedValue === null) {
				continue;
			}

			const newKey = newKeyTemplate.replace('{name}', settingName);

			await config.update(newKey, processedValue, vscode.ConfigurationTarget.Global);
			log.info(`[${migrationName}] Migrated: ${newKey}`);
		}

		await config.update(oldKey, undefined, vscode.ConfigurationTarget.Global);
		log.info(`[${migrationName}] Removed old setting`);

		showMigrationNotification(config, notificationKey, notificationMessage, searchQuery);
	} catch (error) {
		log.error(`[${migrationName}] Migration failed: ${JSON.stringify(error, null, 2)}`);
		if (oldKey === 'enabledProviders') {
			vscode.window.showErrorMessage(
				vscode.l10n.t('Failed to migrate provider configuration: {0}', JSON.stringify(error))
			);
		}
	}
}

export async function performProviderMigration(): Promise<void> {
	await migrateSettings<string>(
		'enabledProviders',
		'provider.{name}.enable',
		'hideProviderMigrationNotification',
		vscode.l10n.t(`Your 'positron.assistant.enabledProviders' setting has been migrated to individual enable settings for each provider. The old setting has been removed.`),
		PROVIDER_ENABLE_SETTINGS_SEARCH
	);
}

export async function performModelPreferencesMigration(): Promise<void> {
	await migrateSettings<string>(
		'models.preference.byProvider',
		'models.preference.{name}',
		'hideModelPreferencesMigrationNotification',
		vscode.l10n.t(`Your 'positron.assistant.models.preference.byProvider' setting has been migrated to individual preference settings for each provider. The old setting has been removed.`),
		'positron.assistant.models.preference'
	);
}

export async function performCustomModelsMigration(): Promise<void> {
	await migrateSettings<any[]>(
		'models.custom',
		'models.overrides.{name}',
		'hideCustomModelsMigrationNotification',
		vscode.l10n.t(`Your 'positron.assistant.models.custom' setting has been migrated to individual model override settings for each provider. The old setting has been removed.`),
		'positron.assistant.models.overrides',
		(_, value) => value.length > 0 ? value : null
	);
}
