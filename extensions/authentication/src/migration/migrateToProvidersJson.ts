/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { log } from '../log';
import {
	buildProvidersConfigFromSettings,
	MIGRATABLE_SETTING_KEYS,
	MigrationSettingsReader,
} from './providersJson';

export type MigrationResult =
	| { outcome: 'migrated'; settingCount: number }
	| { outcome: 'skipped-populated' }
	| { outcome: 'nothing-to-migrate' };

export interface RunMigrationOptions {
	/** Replace a populated providers block instead of skipping (manual command only). */
	overwrite: boolean;
	/** Override providers.json path (tests). */
	configPath?: string;
	/** Override the settings source (tests). */
	reader?: MigrationSettingsReader;
}

/** Reads explicitly-set GLOBAL values only; defaults and workspace scopes are ignored. */
export function createGlobalSettingsReader(): MigrationSettingsReader {
	return {
		globalValue: <T,>(key: string) =>
			vscode.workspace.getConfiguration().inspect<T>(key)?.globalValue,
	};
}

export function hasMigratableSettings(
	reader: MigrationSettingsReader = createGlobalSettingsReader()
): boolean {
	return MIGRATABLE_SETTING_KEYS.some(key => reader.globalValue(key) !== undefined);
}

/**
 * True when the user's providers.json file already carries provider config.
 * Reads through ai-config's source assembly (never raw fs) so file location,
 * JSONC handling, and validation fallbacks stay in one place.
 */
export async function userProvidersFileIsPopulated(configPath?: string): Promise<boolean> {
	const { loadConfigSources } = await import('ai-config/node');
	const sources = await loadConfigSources({
		configPath,
		logger: { debug: (m: string) => log.debug(m), warn: (m: string) => log.warn(m) },
	});
	const userSource = sources.find(source => source.kind === 'user');
	const providers = userSource?.config.providers;
	return !!providers && Object.keys(providers).length > 0;
}

/**
 * One-shot migration: writes the mapped config through mutateProvidersConfig.
 * The populated-file guard lives INSIDE the mutator, so the check and the
 * write happen under ai-config's cross-process lock.
 */
export async function runMigration(opts: RunMigrationOptions): Promise<MigrationResult> {
	const reader = opts.reader ?? createGlobalSettingsReader();
	const mapped = buildProvidersConfigFromSettings(reader);
	if (!mapped) {
		log.info('[migration] No provider settings to migrate');
		return { outcome: 'nothing-to-migrate' };
	}

	const { mutateProvidersConfig } = await import('ai-config/node');
	let skippedPopulated = false;
	await mutateProvidersConfig(
		current => {
			if (!opts.overwrite && current.providers && Object.keys(current.providers).length > 0) {
				skippedPopulated = true;
				return current;
			}
			return { ...current, providers: mapped.config.providers };
		},
		{
			configPath: opts.configPath,
			logger: { debug: (m: string) => log.debug(m), warn: (m: string) => log.warn(m) },
		}
	);

	if (skippedPopulated) {
		log.info('[migration] providers.json already has provider config; skipped');
		return { outcome: 'skipped-populated' };
	}
	log.info(`[migration] Migrated ${mapped.settingCount} setting(s) to providers.json`);
	return { outcome: 'migrated', settingCount: mapped.settingCount };
}
