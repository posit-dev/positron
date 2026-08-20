/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import type { SupportedCustomClientKind } from 'ai-config';
import { isOfferedCustomKind } from './customProviderAuth';
import {
	ANTHROPIC_AUTH_PROVIDER_ID,
	ANTHROPIC_DEFAULT_BASE_URL,
	AWS_AUTH_PROVIDER_ID,
	CUSTOM_PROVIDER_AUTH_PROVIDER_ID,
	DATABRICKS_AUTH_PROVIDER_ID,
	DEEPSEEK_AUTH_PROVIDER_ID,
	DEEPSEEK_DEFAULT_BASE_URL,
	FOUNDRY_AUTH_PROVIDER_ID,
	GEMINI_AUTH_PROVIDER_ID,
	GEMINI_DEFAULT_BASE_URL,
	GOOGLE_CLOUD_AUTH_PROVIDER_ID,
	OPENAI_AUTH_PROVIDER_ID,
	OPENAI_DEFAULT_BASE_URL,
	POSIT_AUTH_PROVIDER_ID,
	VERTEX_DEFAULT_BASE_URL,
} from './constants';
import { getConfiguredSnowflakeAccount } from './credentials/snowflake';
import { getCachedCustomProviders, getCachedProvider, type ResolvedProviderLike } from './providerCatalog';

function getSavedBaseUrl(catalogId: string | undefined, fallback?: string): string | undefined {
	return (catalogId && getCachedProvider(catalogId)?.connection.baseUrl) || fallback;
}

export interface ProviderMetadata {
	id: string;
	displayName: string;
	/**
	 * Maturity status of the provider, mirroring the `tags` on its
	 * `*.enable` setting. The config modal lists stable providers (no status)
	 * first, then 'preview', then 'experimental'. Providers that aren't ready
	 * yet are kept out of the modal by defaulting their `*.enable` setting to
	 * false, not by status.
	 */
	status?: 'preview' | 'experimental';
	/** Provider id in the resolved catalog (providers.json); undefined for providers with no catalog entry. */
	readonly catalogId?: string;
}

export const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
	anthropic: {
		id: ANTHROPIC_AUTH_PROVIDER_ID,
		displayName: 'Anthropic',
		catalogId: 'anthropic',
	},
	positAI: {
		id: POSIT_AUTH_PROVIDER_ID,
		displayName: 'Posit AI',
		catalogId: 'positai',
	},
	amazonBedrock: {
		id: AWS_AUTH_PROVIDER_ID,
		displayName: 'Amazon Bedrock',
		catalogId: 'bedrock',
	},
	foundry: {
		id: FOUNDRY_AUTH_PROVIDER_ID,
		displayName: 'Microsoft Foundry',
		catalogId: 'ms-foundry',
	},
	snowflake: {
		id: 'snowflake-cortex',
		displayName: 'Snowflake Cortex',
		catalogId: 'snowflake-cortex',
	},
	openai: {
		id: OPENAI_AUTH_PROVIDER_ID,
		displayName: 'OpenAI',
		catalogId: 'openai',
	},
	google: {
		id: GEMINI_AUTH_PROVIDER_ID,
		displayName: 'Google Gemini',
		status: 'experimental',
		catalogId: 'gemini',
	},
	geap: {
		id: GOOGLE_CLOUD_AUTH_PROVIDER_ID,
		displayName: 'Gemini Enterprise Agent Platform',
		status: 'experimental',
		catalogId: 'google-vertex',
	},
	copilot: {
		id: 'copilot-auth',
		displayName: 'GitHub Copilot',
		status: 'preview',
		catalogId: 'copilot',
	},
	customProvider: {
		id: CUSTOM_PROVIDER_AUTH_PROVIDER_ID,
		displayName: 'Custom Provider',
		status: 'experimental',
		catalogId: 'openai-compatible',
	},
	deepseek: {
		id: DEEPSEEK_AUTH_PROVIDER_ID,
		displayName: 'DeepSeek',
		status: 'experimental',
		catalogId: 'deepseek',
	},
	databricks: {
		id: DATABRICKS_AUTH_PROVIDER_ID,
		displayName: 'Databricks',
		status: 'experimental',
		catalogId: 'databricks',
	},
};

export function getProviderSources(): positron.ai.LanguageModelSource[] {
	// GEAP shows an autoconfigure label only when project + location come from
	// env vars. If the user supplied them via settings, the modal behaves like
	// Bedrock (no label, Sign Out button visible).
	const geapFromEnv = !!process.env.GOOGLE_VERTEX_PROJECT
		&& !!process.env.GOOGLE_VERTEX_LOCATION;

	// The workspace host lives in its own connection section, not baseUrl:
	// the bridge derives the serving-endpoints URL from it.
	const databricksHost = getCachedProvider(
		PROVIDER_METADATA.databricks.catalogId!
	)?.connection.databricks?.host ?? '';

	return [
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.anthropic,
			supportedOptions: ['apiKey', 'baseUrl', 'autoconfigure'],
			defaults: {
				model: 'claude-sonnet-4-latest',
				baseUrl: getSavedBaseUrl(PROVIDER_METADATA.anthropic.catalogId, ANTHROPIC_DEFAULT_BASE_URL),
				toolCalls: true,
				autoconfigure: {
					type: positron.ai.LanguageModelAutoconfigureType.EnvVariable,
					key: 'ANTHROPIC_API_KEY',
					signedIn: false,
				},
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.positAI,
			supportedOptions: ['oauth'],
			defaults: {
				model: 'claude-sonnet-4-5-20250929',
				toolCalls: true,
				oauth: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.amazonBedrock,
			supportedOptions: ['toolCalls'],
			defaults: {
				model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
				toolCalls: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.foundry,
			supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
			defaults: {
				model: 'model-router',
				baseUrl: getSavedBaseUrl(PROVIDER_METADATA.foundry.catalogId),
				toolCalls: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.snowflake,
			supportedOptions: ['apiKey', 'baseUrl', 'toolCalls', 'autoconfigure'],
			defaults: {
				model: 'claude-4-sonnet',
				// baseUrl holds the bare account, not a URL: the Cortex URL is
				// derived from the account. Don't make it a saved setting (#13750).
				baseUrl: getConfiguredSnowflakeAccount(
					getCachedProvider(PROVIDER_METADATA.snowflake.catalogId!)?.connection.snowflake
				),
				toolCalls: true,
				autoconfigure: {
					type: positron.ai.LanguageModelAutoconfigureType.Custom,
					message: 'Snowflake credentials',
					signedIn: false,
				},
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.openai,
			supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
			defaults: {
				model: 'openai',
				baseUrl: getSavedBaseUrl(PROVIDER_METADATA.openai.catalogId, OPENAI_DEFAULT_BASE_URL),
				toolCalls: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.google,
			supportedOptions: ['baseUrl', 'apiKey'],
			defaults: {
				model: 'gemini-2.5-flash',
				baseUrl: getSavedBaseUrl(
					PROVIDER_METADATA.google.catalogId,
					GEMINI_DEFAULT_BASE_URL
				),
				apiKey: undefined,
				toolCalls: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.geap,
			// In env-var mode, omit 'baseUrl' from supportedOptions so the
			// modal renders the simple env-var-driven label without trying
			// to derive a _BASE_URL peer (the modal's derivation assumes a
			// _API_KEY suffix, which doesn't apply here).
			supportedOptions: geapFromEnv
				? ['autoconfigure']
				: ['baseUrl', 'toolCalls'],
			defaults: {
				model: 'gemini-2.5-flash',
				baseUrl: getSavedBaseUrl(PROVIDER_METADATA.geap.catalogId, VERTEX_DEFAULT_BASE_URL),
				toolCalls: true,
				...(geapFromEnv && {
					autoconfigure: {
						type: positron.ai.LanguageModelAutoconfigureType.EnvVariable,
						key: 'GOOGLE_VERTEX_PROJECT',
						signedIn: false,
					},
				}),
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.copilot,
			supportedOptions: ['oauth', 'autoconfigure'],
			defaults: {
				model: 'github-copilot',
				autoconfigure: {
					type: positron.ai.LanguageModelAutoconfigureType.Custom,
					message: 'the Accounts menu.',
					signedIn: false,
				},
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.customProvider,
			supportedOptions: ['apiKey', 'baseUrl', 'toolCalls', 'protocol', 'customModels'],
			defaults: {
				model: 'openai-compatible',
				baseUrl: getSavedBaseUrl(
					PROVIDER_METADATA.customProvider.catalogId,
					'https://localhost:1337/v1'
				),
				toolCalls: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.deepseek,
			supportedOptions: ['apiKey', 'baseUrl', 'autoconfigure'],
			defaults: {
				model: 'deepseek-chat',
				baseUrl: getSavedBaseUrl(PROVIDER_METADATA.deepseek.catalogId, DEEPSEEK_DEFAULT_BASE_URL),
				toolCalls: true,
				autoconfigure: {
					type: positron.ai.LanguageModelAutoconfigureType.EnvVariable,
					key: 'DEEPSEEK_API_KEY',
					signedIn: false,
				},
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.databricks,
			// baseUrl carries the workspace host through the modal only. It is
			// saved to (and read from) connection.databricks.host, never the
			// provider baseUrl: per-model endpoint resolution falls back to
			// baseUrl, which would route chat at the bare host and 404.
			// OAuth U2M is desktop-only (the loopback redirect can't reach a
			// remote or web extension host) and needs the new provider modal:
			// the legacy modal derives "OAuth if supported" with no working
			// method picker, so offering oauth there would remove PAT entry.
			// The gate goes away with the legacy modal.
			supportedOptions: (
				vscode.env.remoteName === undefined &&
				vscode.env.uiKind !== vscode.UIKind.Web &&
				vscode.workspace.getConfiguration('assistant').get<boolean>('newProviderModal') === true
			)
				? ['oauth', 'apiKey', 'baseUrl', 'autoconfigure']
				: ['apiKey', 'baseUrl', 'autoconfigure'],
			defaults: {
				model: 'databricks',
				baseUrl: databricksHost,
				toolCalls: true,
				autoconfigure: {
					type: positron.ai.LanguageModelAutoconfigureType.EnvVariable,
					key: 'DATABRICKS_TOKEN',
					signedIn: false,
				},
			},
		},
	];
}

/** One entry in a source's `supportedOptions` list. */
type SupportedOption = positron.ai.LanguageModelSource['supportedOptions'][number];

/**
 * Which built-in provider a custom entry's kind takes its form from. A custom
 * Anthropic entry asks for what the built-in Anthropic tile asks for, so the
 * two can't drift: the list is read from the built-in source itself rather than
 * restated here.
 *
 * Covers the kinds Positron offers (see `isOfferedCustomKind`), each of which
 * has a built-in counterpart to borrow from.
 */
const BUILTIN_FORM_BY_KIND: Partial<Record<SupportedCustomClientKind, keyof typeof PROVIDER_METADATA>> = {
	'openai-compatible': 'customProvider',
	anthropic: 'anthropic',
	openai: 'openai',
};

/**
 * Options a custom entry never shows, whatever its built-in offers.
 *
 * `autoconfigure` is the env-var credential path, which belongs to the one
 * built-in instance of a provider: `ANTHROPIC_API_KEY` is a single value and
 * can't say which of three custom Anthropic entries it is for. `oauth` is
 * product-bound (Posit AI, Copilot, Databricks), and those kinds aren't
 * offered as custom entries at all. `protocol` is the API type field, which
 * this work removes: the kind carries the wire format (#13817).
 */
const OPTIONS_NOT_FOR_CUSTOM: ReadonlySet<SupportedOption> = new Set<SupportedOption>([
	'autoconfigure', 'oauth', 'protocol',
]);

/** What every offered kind needs at minimum: somewhere to call, and a key. */
const BASE_OPTIONS: SupportedOption[] = ['apiKey', 'baseUrl'];

/**
 * The fields a custom entry of this kind collects: its built-in's own list,
 * minus what only the built-in can use, plus the model-id list every custom
 * entry needs for an endpoint that doesn't list its own models.
 */
function customSupportedOptions(kind: string): SupportedOption[] {
	const builtinKey = BUILTIN_FORM_BY_KIND[kind as SupportedCustomClientKind];
	const builtinId = builtinKey && PROVIDER_METADATA[builtinKey].id;
	const builtin = builtinId
		? getProviderSources().find(source => source.provider.id === builtinId)
		: undefined;

	const inherited = (builtin?.supportedOptions ?? BASE_OPTIONS)
		.filter(option => !OPTIONS_NOT_FOR_CUSTOM.has(option));
	const options = inherited.length > 0 ? inherited : BASE_OPTIONS;

	return options.includes('customModels') ? options : [...options, 'customModels'];
}

/**
 * Builds the model source for one `providers.custom` entry. The entry name is
 * the provider id, the display name, and the catalog id all at once: it is the
 * key in providers.json, and Positron registers its auth provider under the
 * same string so the credential is derivable from the id alone.
 */
export function customProviderSource(
	provider: ResolvedProviderLike
): positron.ai.LanguageModelSource {
	return {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: provider.id,
			displayName: provider.id,
			status: 'experimental',
			catalogId: provider.id,
		},
		supportedOptions: customSupportedOptions(provider.clientKind),
		defaults: {
			model: provider.id,
			baseUrl: provider.connection.baseUrl ?? provider.connection.endpoint,
			toolCalls: true,
		},
	};
}

/**
 * Enabled custom entries whose client kind this host can present. Kept apart
 * from {@link getProviderSources} because these are registered and
 * unregistered as the config file changes, while the built-in list is fixed at
 * activation.
 *
 * An entry of a kind Positron doesn't offer yet is skipped rather than shown
 * half-configured; `isOfferedCustomKind` says which those are and why.
 */
export function getRegistrableCustomProviders(): ResolvedProviderLike[] {
	return getCachedCustomProviders()
		.filter(provider => provider.enabled && isOfferedCustomKind(provider.clientKind));
}
