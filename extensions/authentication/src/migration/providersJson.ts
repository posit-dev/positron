/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { InferredModelCapabilities, ProvidersConfig } from 'ai-config/node';
import { normalizeToV1Url } from '../validation';

export type InferCapabilitiesFn = (providerId: string, modelId: string) => InferredModelCapabilities;

/** Reads one setting's explicitly-set GLOBAL value (undefined when unset). */
export interface MigrationSettingsReader {
	globalValue<T>(key: string): T | undefined;
}

/** One settings.json key mapped to the dotted providers.json path it wrote. */
export interface SettingMigration {
	/** Source settings.json key. */
	readonly source: string;
	/** Destination providers.json dotted path (e.g. providers.openai.baseUrl). */
	readonly destination: string;
}

export interface MappedProvidersConfig {
	config: ProvidersConfig;
	/** Number of settings.json entries consumed (for the success toast). */
	settingCount: number;
	/** Source-to-destination record of every value written (for logging). */
	migrations: SettingMigration[];
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

interface ModelOverrideSetting {
	/** positron.assistant.models.overrides.<settingName>. */
	readonly settingName: string;
	readonly providerId: string;
}

const MODEL_OVERRIDE_SETTINGS: readonly ModelOverrideSetting[] = [
	{ settingName: 'anthropic', providerId: 'anthropic' },
	{ settingName: 'amazonBedrock', providerId: 'bedrock' },
	{ settingName: 'snowflakeCortex', providerId: 'snowflake-cortex' },
	{ settingName: 'msFoundry', providerId: 'ms-foundry' },
	{ settingName: 'openAI', providerId: 'openai' },
	{ settingName: 'customProvider', providerId: 'openai-compatible' },
	{ settingName: 'positAI', providerId: 'positai' },
	{ settingName: 'google', providerId: 'gemini' },
];

/** Shape of one legacy positron.assistant.models.overrides.<name> entry. */
interface LegacyModelOverride {
	name: string;
	identifier: string;
	maxInputTokens?: number;
	maxOutputTokens?: number;
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

/** Every setting the migration consumes; hasMigratableSettings scans this. */
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
	...MODEL_OVERRIDE_SETTINGS.map(s => `positron.assistant.models.overrides.${s.settingName}`),
];

// providers.json blocks are plain data; build them as records and assign into
// the (structurally typed) ProvidersConfig at the end.
type Block = Record<string, unknown>;

export function buildProvidersConfigFromSettings(
	reader: MigrationSettingsReader,
	inferCapabilities: InferCapabilitiesFn
): MappedProvidersConfig | undefined {
	const providers: Record<string, Block> = {};
	const migrations: SettingMigration[] = [];

	const merge = (providerId: string, fragment: Block) => {
		providers[providerId] = { ...providers[providerId], ...fragment };
	};
	const record = (source: string, destination: string) => {
		migrations.push({ source, destination });
	};

	// --- authentication.<configKey>.{baseUrl,customHeaders} -----------------
	for (const s of API_KEY_CONNECTION_SETTINGS) {
		const rawBaseUrl = nonEmptyString(reader.globalValue<string>(`authentication.${s.configKey}.baseUrl`));
		if (rawBaseUrl) {
			merge(s.providerId, { baseUrl: s.normalizeBaseUrl ? s.normalizeBaseUrl(rawBaseUrl) : rawBaseUrl });
			record(`authentication.${s.configKey}.baseUrl`, `providers.${s.providerId}.baseUrl`);
		}
		const headers = nonEmptyHeaders(reader.globalValue<Record<string, string>>(`authentication.${s.configKey}.customHeaders`));
		if (headers) {
			merge(s.providerId, { customHeaders: headers });
			record(`authentication.${s.configKey}.customHeaders`, `providers.${s.providerId}.customHeaders`);
		}
	}

	// --- authentication.googleVertex.credentials -> googleCloud -------------
	const vertexCreds = reader.globalValue<Record<string, string>>('authentication.googleVertex.credentials');
	const googleCloud: Block = {};
	if (nonEmptyString(vertexCreds?.GOOGLE_VERTEX_PROJECT)) {
		googleCloud.project = vertexCreds!.GOOGLE_VERTEX_PROJECT;
		record('authentication.googleVertex.credentials', 'providers.google-vertex.googleCloud.project');
	}
	if (nonEmptyString(vertexCreds?.GOOGLE_VERTEX_LOCATION)) {
		googleCloud.location = vertexCreds!.GOOGLE_VERTEX_LOCATION;
		record('authentication.googleVertex.credentials', 'providers.google-vertex.googleCloud.location');
	}
	if (Object.keys(googleCloud).length > 0) {
		merge('google-vertex', { googleCloud });
	}

	// --- authentication.aws.credentials -> bedrock.aws -----------------------
	const awsCreds = reader.globalValue<Record<string, string>>('authentication.aws.credentials');
	const aws: Block = {};
	if (nonEmptyString(awsCreds?.AWS_PROFILE)) {
		aws.profile = awsCreds!.AWS_PROFILE;
		record('authentication.aws.credentials', 'providers.bedrock.aws.profile');
	}
	if (nonEmptyString(awsCreds?.AWS_REGION)) {
		aws.region = awsCreds!.AWS_REGION;
		record('authentication.aws.credentials', 'providers.bedrock.aws.region');
	}
	if (Object.keys(aws).length > 0) {
		merge('bedrock', { aws });
	}

	// --- authentication.snowflake.* -> snowflake-cortex ----------------------
	const snowflakeCreds = reader.globalValue<Record<string, string>>('authentication.snowflake.credentials');
	const snowflake: Block = {};
	if (nonEmptyString(snowflakeCreds?.SNOWFLAKE_ACCOUNT)) {
		snowflake.account = snowflakeCreds!.SNOWFLAKE_ACCOUNT;
		record('authentication.snowflake.credentials', 'providers.snowflake-cortex.snowflake.account');
	}
	if (nonEmptyString(snowflakeCreds?.SNOWFLAKE_HOME)) {
		snowflake.home = snowflakeCreds!.SNOWFLAKE_HOME;
		record('authentication.snowflake.credentials', 'providers.snowflake-cortex.snowflake.home');
	}
	if (Object.keys(snowflake).length > 0) {
		merge('snowflake-cortex', { snowflake });
	}
	const snowflakeHeaders = nonEmptyHeaders(reader.globalValue<Record<string, string>>('authentication.snowflake.customHeaders'));
	if (snowflakeHeaders) {
		merge('snowflake-cortex', { customHeaders: snowflakeHeaders });
		record('authentication.snowflake.customHeaders', 'providers.snowflake-cortex.customHeaders');
	}

	// --- enablement toggles -> providers.<id>.enabled ------------------------
	for (const s of ENABLEMENT_SETTINGS) {
		const newValue = s.newKey ? reader.globalValue<boolean>(s.newKey) : undefined;
		const oldValue = s.oldKey ? reader.globalValue<boolean>(s.oldKey) : undefined;
		const enabled = newValue ?? oldValue;
		if (enabled !== undefined) {
			merge(s.providerId, { enabled });
			record(newValue !== undefined ? s.newKey! : s.oldKey!, `providers.${s.providerId}.enabled`);
		}
	}

	// --- model overrides -> models.custom + discovery off --------------------
	for (const s of MODEL_OVERRIDE_SETTINGS) {
		const raw = reader.globalValue<LegacyModelOverride[]>(`positron.assistant.models.overrides.${s.settingName}`);
		if (!Array.isArray(raw)) {
			continue;
		}
		const entries = raw.filter((e): e is LegacyModelOverride =>
			!!e && typeof e === 'object' && typeof e.name === 'string' && typeof e.identifier === 'string');
		if (entries.length === 0) {
			continue;
		}
		const custom = entries.map(entry => buildCustomModel(s.providerId, entry, inferCapabilities));
		merge(s.providerId, { models: { discovery: 'off', custom } });
		record(`positron.assistant.models.overrides.${s.settingName}`, `providers.${s.providerId}.models.custom`);
	}

	if (Object.keys(providers).length === 0) {
		return undefined;
	}
	return {
		config: { providers } as ProvidersConfig,
		settingCount: new Set(migrations.map(m => m.source)).size,
		migrations,
	};
}

/**
 * Legacy entries carry only name/identifier/token limits; capabilities are
 * synthesized, user token limits win, and maxContextLength never drops below
 * the user's maxInputTokens.
 */
function buildCustomModel(providerId: string, entry: LegacyModelOverride, inferCapabilities: InferCapabilitiesFn): Block {
	const caps = inferCapabilities(providerId, entry.identifier);
	const maxInputTokens = entry.maxInputTokens ?? caps.maxInputTokens;
	const maxOutputTokens = entry.maxOutputTokens ?? caps.maxOutputTokens;
	const model: Block = {
		id: entry.identifier,
		name: entry.name,
		maxContextLength: Math.max(caps.maxContextLength, entry.maxInputTokens ?? 0),
		supportsTools: caps.supportsTools,
		supportsImages: caps.supportsImages,
		supportsToolResultImages: caps.supportsToolResultImages,
		supportsWebSearch: caps.supportsWebSearch,
	};
	if (maxInputTokens !== undefined) {
		model.maxInputTokens = maxInputTokens;
	}
	if (maxOutputTokens !== undefined) {
		model.maxOutputTokens = maxOutputTokens;
	}
	if (caps.thinkingEffortLevels !== undefined) {
		model.thinkingEffortLevels = caps.thinkingEffortLevels;
	}
	if (caps.protocol !== undefined) {
		model.protocol = caps.protocol;
	}
	return model;
}

function nonEmptyString(value: string | undefined): string | undefined {
	return value && value.trim() !== '' ? value : undefined;
}

function nonEmptyHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
	return headers && Object.keys(headers).length > 0 ? headers : undefined;
}
