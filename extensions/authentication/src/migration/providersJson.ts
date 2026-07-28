/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * PROVIDER-SETTINGS-MIGRATION(legacy-positron): the legacy settings →
 * providers.json map and translator live in ai-config
 * (`translateLegacyPositronSettings`), shared with the catalog's runtime
 * legacy layers so the migration and the runtime channels can never diverge.
 * This module is the migration-shaped wrapper over that translator.
 */

import { legacySettingKeys, translateLegacyPositronSettings, type ProvidersConfigFragment, type LoggerLike, type SettingMigration } from 'ai-config';

export type { SettingMigration };

/** Reads one setting's explicitly-set GLOBAL value (undefined when unset). */
export interface MigrationSettingsReader {
	globalValue<T>(key: string): T | undefined;
}

export interface MappedProvidersConfig {
	/**
	 * The assembled providers.json fragment. runMigration validates it through
	 * providersConfigSchema before writing, so a bad mapping fails loudly there
	 * instead of writing malformed providers.json.
	 */
	config: ProvidersConfigFragment;
	/** Number of settings.json entries consumed (for the success toast). */
	settingCount: number;
	/** Source-to-destination record of every value written (for logging). */
	migrations: readonly SettingMigration[];
}

/** Every setting the migration consumes. */
export const MIGRATABLE_SETTING_KEYS: readonly string[] = legacySettingKeys();

/**
 * Translate the legacy settings visible through `reader` into a
 * providers.json fragment, or `undefined` when nothing maps (empty values are
 * filtered). Base URLs are written in their corrected form (a bare
 * `https://api.anthropic.com` becomes `.../v1`) — providers.json gets no
 * runtime correction, so a verbatim bare host would be broken as written.
 * Wrong-shaped values are dropped per key; `logger` receives one warning per
 * dropped key, so a migration that skips a setting says so instead of
 * silently reporting success.
 */
export function buildProvidersConfigFromSettings(
	reader: MigrationSettingsReader,
	logger?: LoggerLike
): MappedProvidersConfig | undefined {
	const { config, migrations } = translateLegacyPositronSettings({
		get: key => reader.globalValue(key),
	}, logger);
	if (!config.providers || Object.keys(config.providers).length === 0) {
		return undefined;
	}
	return {
		config,
		// The toast counts distinct source settings, not destination fields.
		settingCount: new Set(migrations.map(m => m.source)).size,
		migrations,
	};
}
