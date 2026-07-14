/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProvidersConfig } from 'ai-config/node';
import { normalizeToV1Url } from '../validation';

/** Reads one setting's explicitly-set GLOBAL value (undefined when unset). */
export interface MigrationSettingsReader {
	globalValue<T>(key: string): T | undefined;
}

export interface MappedProvidersConfig {
	config: ProvidersConfig;
	/** Number of settings.json entries consumed (for the success toast). */
	settingCount: number;
}

interface ApiKeyConnectionSetting {
	readonly configKey: string;
	readonly providerId: string;
	readonly normalizeBaseUrl?: (url: string) => string;
}

/** authentication.<configKey>.{baseUrl,customHeaders} -> providers.<id>. */
const API_KEY_CONNECTION_SETTINGS: readonly ApiKeyConnectionSetting[] = [
	{ configKey: 'anthropic', providerId: 'anthropic' },
	{ configKey: 'openai-api', providerId: 'openai' },
	{ configKey: 'google', providerId: 'gemini' },
	{ configKey: 'deepseek-api', providerId: 'deepseek' },
	{ configKey: 'foundry', providerId: 'ms-foundry', normalizeBaseUrl: normalizeToV1Url },
	{ configKey: 'openai-compatible', providerId: 'openai-compatible' },
	{ configKey: 'googleVertex', providerId: 'google-vertex' },
];

interface EnablementSetting {
	readonly providerId: string;
	/** positron.assistant.provider.<name>.enable (older generation). */
	readonly oldKey?: string;
	/** assistant.provider.<name>.enabled (newer generation; wins when both set). */
	readonly newKey?: string;
}

const ENABLEMENT_SETTINGS: readonly EnablementSetting[] = [
	{ providerId: 'anthropic', oldKey: 'positron.assistant.provider.anthropic.enable' },
	{ providerId: 'openai', oldKey: 'positron.assistant.provider.openAI.enable' },
	{ providerId: 'gemini', oldKey: 'positron.assistant.provider.google.enable' },
	{ providerId: 'bedrock', oldKey: 'positron.assistant.provider.amazonBedrock.enable' },
	{ providerId: 'snowflake-cortex', oldKey: 'positron.assistant.provider.snowflakeCortex.enable' },
	{ providerId: 'ms-foundry', oldKey: 'positron.assistant.provider.msFoundry.enable' },
	{ providerId: 'openai-compatible', oldKey: 'positron.assistant.provider.customProvider.enable' },
	{ providerId: 'positai', oldKey: 'positron.assistant.provider.positAI.enable' },
	{ providerId: 'copilot', oldKey: 'positron.assistant.provider.githubCopilot.enable' },
	{ providerId: 'google-vertex', newKey: 'assistant.provider.googleVertex.enabled' },
	{ providerId: 'deepseek', newKey: 'assistant.provider.deepseek.enabled' },
];

/**
 * Every setting the migration consumes; Task 3's hasMigratableSettings scans
 * this. Task 8 appends the positron.assistant.models.overrides.<name> keys
 * when model-overrides migration lands.
 */
export const MIGRATABLE_SETTING_KEYS: readonly string[] = [
	...API_KEY_CONNECTION_SETTINGS.flatMap(s => [
		`authentication.${s.configKey}.baseUrl`,
		`authentication.${s.configKey}.customHeaders`,
	]),
	'authentication.googleVertex.credentials',
	'authentication.aws.credentials',
	'authentication.snowflake.credentials',
	'authentication.snowflake.customHeaders',
	...ENABLEMENT_SETTINGS.flatMap(s => [s.oldKey, s.newKey]).filter((k): k is string => !!k),
];

// providers.json blocks are plain data; build them as records and assign into
// the (structurally typed) ProvidersConfig at the end.
type Block = Record<string, unknown>;

export function buildProvidersConfigFromSettings(
	reader: MigrationSettingsReader
): MappedProvidersConfig | undefined {
	const providers: Record<string, Block> = {};
	let settingCount = 0;

	const merge = (providerId: string, fragment: Block) => {
		providers[providerId] = { ...providers[providerId], ...fragment };
	};

	// --- authentication.<configKey>.{baseUrl,customHeaders} -----------------
	for (const s of API_KEY_CONNECTION_SETTINGS) {
		const rawBaseUrl = nonEmptyString(reader.globalValue<string>(`authentication.${s.configKey}.baseUrl`));
		if (rawBaseUrl) {
			merge(s.providerId, { baseUrl: s.normalizeBaseUrl ? s.normalizeBaseUrl(rawBaseUrl) : rawBaseUrl });
			settingCount++;
		}
		const headers = nonEmptyHeaders(reader.globalValue<Record<string, string>>(`authentication.${s.configKey}.customHeaders`));
		if (headers) {
			merge(s.providerId, { customHeaders: headers });
			settingCount++;
		}
	}

	// --- authentication.googleVertex.credentials -> googleCloud -------------
	const vertexCreds = reader.globalValue<Record<string, string>>('authentication.googleVertex.credentials');
	const googleCloud: Block = {};
	if (nonEmptyString(vertexCreds?.GOOGLE_VERTEX_PROJECT)) {
		googleCloud.project = vertexCreds!.GOOGLE_VERTEX_PROJECT;
	}
	if (nonEmptyString(vertexCreds?.GOOGLE_VERTEX_LOCATION)) {
		googleCloud.location = vertexCreds!.GOOGLE_VERTEX_LOCATION;
	}
	if (Object.keys(googleCloud).length > 0) {
		merge('google-vertex', { googleCloud });
		settingCount++;
	}

	// --- authentication.aws.credentials -> bedrock.aws -----------------------
	const awsCreds = reader.globalValue<Record<string, string>>('authentication.aws.credentials');
	const aws: Block = {};
	if (nonEmptyString(awsCreds?.AWS_PROFILE)) {
		aws.profile = awsCreds!.AWS_PROFILE;
	}
	if (nonEmptyString(awsCreds?.AWS_REGION)) {
		aws.region = awsCreds!.AWS_REGION;
	}
	if (Object.keys(aws).length > 0) {
		merge('bedrock', { aws });
		settingCount++;
	}

	// --- authentication.snowflake.* -> snowflake-cortex ----------------------
	// SNOWFLAKE_HOME migrates in a later task once ai-lib ships snowflake.home
	// (posit-dev/ai-lib#8); only SNOWFLAKE_ACCOUNT maps here.
	const snowflakeCreds = reader.globalValue<Record<string, string>>('authentication.snowflake.credentials');
	if (nonEmptyString(snowflakeCreds?.SNOWFLAKE_ACCOUNT)) {
		merge('snowflake-cortex', { snowflake: { account: snowflakeCreds!.SNOWFLAKE_ACCOUNT } });
		settingCount++;
	}
	const snowflakeHeaders = nonEmptyHeaders(reader.globalValue<Record<string, string>>('authentication.snowflake.customHeaders'));
	if (snowflakeHeaders) {
		merge('snowflake-cortex', { customHeaders: snowflakeHeaders });
		settingCount++;
	}

	// --- enablement toggles -> providers.<id>.enabled ------------------------
	for (const s of ENABLEMENT_SETTINGS) {
		const newValue = s.newKey ? reader.globalValue<boolean>(s.newKey) : undefined;
		const oldValue = s.oldKey ? reader.globalValue<boolean>(s.oldKey) : undefined;
		const enabled = newValue ?? oldValue;
		if (enabled !== undefined) {
			merge(s.providerId, { enabled });
			settingCount++;
		}
	}

	if (Object.keys(providers).length === 0) {
		return undefined;
	}
	return {
		config: { providers } as ProvidersConfig,
		settingCount,
	};
}

function nonEmptyString(value: string | undefined): string | undefined {
	return value && value.trim() !== '' ? value : undefined;
}

function nonEmptyHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
	return headers && Object.keys(headers).length > 0 ? headers : undefined;
}
