/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { log } from '../log';
import {
	buildProvidersConfigFromSettings,
	InferCapabilitiesFn,
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
	/** Override capability inference (tests). */
	inferCapabilities?: InferCapabilitiesFn;
}

/** Reads explicitly-set GLOBAL values only; defaults and workspace scopes are ignored. */
export function createGlobalSettingsReader(): MigrationSettingsReader {
	return {
		globalValue: <T,>(key: string) =>
			vscode.workspace.getConfiguration().inspect<T>(key)?.globalValue,
	};
}

/**
 * Zero-value capability synthesizer for presence checks. Capabilities only
 * shape the values written into custom models, never whether a setting
 * migrates, so hasMigratableSettings can stay synchronous instead of
 * dynamically importing ai-config's real inferModelCapabilities.
 */
const PRESENCE_CHECK_CAPABILITIES: InferCapabilitiesFn = () => ({
	maxContextLength: 0,
	supportsTools: false,
	supportsImages: false,
	supportsToolResultImages: false,
	supportsWebSearch: false,
});

/** True when the settings hold values the migration would actually write (empty values are filtered). */
export function hasMigratableSettings(
	reader: MigrationSettingsReader = createGlobalSettingsReader()
): boolean {
	return buildProvidersConfigFromSettings(reader, PRESENCE_CHECK_CAPABILITIES) !== undefined;
}

/**
 * True when the user's providers.json file already carries provider config,
 * or holds content the migration must not silently replace. ai-config's read
 * path coerces unparseable or schema-invalid files to an empty config, which
 * would make a hand-edited file with one typo look unpopulated; this check
 * deliberately reads the raw file and validates it with ai-config's schema
 * so such files count as populated.
 */
export async function userProvidersFileIsPopulated(configPath?: string): Promise<boolean> {
	const { PROVIDERS_CONFIG_PATH, providersConfigSchema } = await import('ai-config/node');
	const filePath = configPath ?? PROVIDERS_CONFIG_PATH;
	let raw: string;
	try {
		raw = await fs.readFile(filePath, 'utf-8');
	} catch {
		return false;
	}
	if (raw.trim() === '') {
		return false;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		log.warn(`[migration] ${filePath} is not valid JSON; treating it as populated`);
		return true;
	}
	const result = providersConfigSchema.safeParse(parsed);
	if (!result.success) {
		log.warn(`[migration] ${filePath} does not match the providers schema; treating it as populated`);
		return true;
	}
	const providers = result.data.providers;
	return !!providers && Object.keys(providers).length > 0;
}

/**
 * One-shot migration: writes the mapped config through mutateProvidersConfig.
 * The populated-file check runs BEFORE the mutator so unparseable files (which
 * the mutator's read coerces to an empty config) and no-op skips never touch
 * the file, and again INSIDE the mutator so the parseable case stays guarded
 * under ai-config's cross-process lock.
 */
export async function runMigration(opts: RunMigrationOptions): Promise<MigrationResult> {
	const reader = opts.reader ?? createGlobalSettingsReader();
	const { mutateProvidersConfig, inferModelCapabilities } = await import('ai-config/node');
	const mapped = buildProvidersConfigFromSettings(reader, opts.inferCapabilities ?? inferModelCapabilities);
	if (!mapped) {
		log.info('[migration] No provider settings to migrate');
		return { outcome: 'nothing-to-migrate' };
	}

	if (!opts.overwrite && await userProvidersFileIsPopulated(opts.configPath)) {
		log.info('[migration] providers.json already has provider config; skipped');
		return { outcome: 'skipped-populated' };
	}

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
	log.info(`[migration] Migrated ${mapped.settingCount} setting(s) to providers.json:`);
	for (const { source, destination } of mapped.migrations) {
		log.info(`[migration]   ${source} -> ${destination}`);
	}
	return { outcome: 'migrated', settingCount: mapped.settingCount };
}
