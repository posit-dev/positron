/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationKeyValuePairs, ConfigurationMigrationFn, Extensions as ConfigurationMigrationExtensions, IConfigurationMigrationRegistry } from '../../../common/configuration.js';

/**
 * Deprecated Positron Assistant setting that controlled inline completion
 * enablement per language. Previously contributed by the built-in
 * positron-assistant extension.
 */
export const DEPRECATED_INLINE_COMPLETIONS_ENABLE_KEY = 'positron.assistant.inlineCompletions.enable';

/**
 * Copilot's native enablement setting, the single source of truth for inline
 * completion enablement (`product.json`'s `completionsEnablementSetting`).
 */
export const COPILOT_ENABLE_KEY = 'github.copilot.enable';

/**
 * Migrates the deprecated `positron.assistant.inlineCompletions.enable` setting
 * to Copilot's native `github.copilot.enable` setting.
 *
 * Both settings share the same `{ [languageId]: boolean }` shape. The deprecated
 * value is merged on top of any existing `github.copilot.enable` value at the
 * same configuration target (the deprecated value wins on conflicting language
 * keys), preserving its precedence. The deprecated setting is then removed.
 *
 * This lives in Positron core rather than the positron-assistant extension so
 * the migration keeps running even after the extension is removed.
 */
export const migrateInlineCompletionsEnablement: ConfigurationMigrationFn = (value, accessor) => {
	// Nothing to migrate unless the deprecated setting holds at least one entry.
	if (typeof value !== 'object' || value === null || Object.keys(value).length === 0) {
		return [];
	}

	const existing = accessor(COPILOT_ENABLE_KEY);
	const mergedValue: Record<string, boolean> = {
		...(typeof existing === 'object' && existing !== null ? existing : undefined),
		...value,
	};

	const pairs: ConfigurationKeyValuePairs = [
		[DEPRECATED_INLINE_COMPLETIONS_ENABLE_KEY, { value: undefined }],
		[COPILOT_ENABLE_KEY, { value: mergedValue }],
	];
	return pairs;
};

Registry.as<IConfigurationMigrationRegistry>(ConfigurationMigrationExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: DEPRECATED_INLINE_COMPLETIONS_ENABLE_KEY,
		migrateFn: migrateInlineCompletionsEnablement,
	}]);
