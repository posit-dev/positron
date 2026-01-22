/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { log } from './extension.js';
import { getModelProviders } from './providers/index.js';
import { PROVIDER_ENABLE_SETTINGS_SEARCH } from './constants.js';

/**
 * Converts old setting formats into a consistent array of [key, value] pairs.
 *
 * Old settings could be stored in two formats:
 * - Array format: ['anthropic', 'openai'] → becomes [['anthropic', true], ['openai', true]]
 * - Object format: { anthropic: 'claude-3' } → becomes [['anthropic', 'claude-3']]
 */
function normalizeToEntries<T>(oldValue: string[] | Record<string, T>): Array<[string, T]> {
	if (Array.isArray(oldValue)) {
		return oldValue.map(id => [id, true as T]);
	}
	return Object.entries(oldValue) as Array<[string, T]>;
}

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
 */
async function migrateSettings<T>(
	oldKey: string,
	newKeyTemplate: string,
	notificationKey: string,
	notificationMessage: string,
	searchQuery: string
): Promise<void> {
	const config = vscode.workspace.getConfiguration('positron.assistant');
	const oldValue = config.inspect<Record<string, T> | string[]>(oldKey)?.globalValue;

	if (!oldValue || (Array.isArray(oldValue) ? oldValue.length === 0 : Object.keys(oldValue).length === 0)) {
		return;
	}

	const migrationName = oldKey.replace(/\./g, '_');
	log.info(`[${migrationName}] Migrating from global settings`);

	const providerMap = getProviderIdToSettingNameMap();
	const entries = normalizeToEntries<T>(oldValue);

	// Build list of updates to perform
	const updates: Array<{ key: string; value: T }> = [];
	for (const [providerId, value] of entries) {
		const settingName = providerMap.get(providerId);
		if (!settingName) {
			log.warn(`[${migrationName}] Unknown provider '${providerId}' in 'positron.assistant.${oldKey}' was not migrated. Valid providers are: ${Array.from(providerMap.keys()).join(', ')}`);
			continue;
		}

		// Skip empty arrays - nothing to migrate
		if (Array.isArray(value) && value.length === 0) {
			continue;
		}

		updates.push({ key: newKeyTemplate.replace('{name}', settingName), value });
	}

	// Apply all updates, continuing even if some fail
	let successCount = 0;
	let failureCount = 0;
	for (const { key, value } of updates) {
		try {
			await config.update(key, value, vscode.ConfigurationTarget.Global);
			log.info(`[${migrationName}] Migrated: ${key}`);
			successCount++;
		} catch (error) {
			log.error(`[${migrationName}] Failed to migrate ${key}: ${JSON.stringify(error)}`);
			failureCount++;
		}
	}

	// Only remove old setting if at least some migrations succeeded
	if (successCount > 0) {
		log.info(`[${migrationName}] Removing old setting: ${JSON.stringify(oldValue)}`);
		await config.update(oldKey, undefined, vscode.ConfigurationTarget.Global);

		const message = failureCount > 0
			? `${notificationMessage} ${vscode.l10n.t('Some settings failed to migrate. Check the logs for details.')}`
			: notificationMessage;
		showMigrationNotification(config, notificationKey, message, searchQuery);
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
		'positron.assistant.models.overrides'
	);
}
