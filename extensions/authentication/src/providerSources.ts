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
import { getCachedCustomProviders, getCachedProvider, getConnectionProvenance, getUserProviderBlock, type ResolvedProviderLike } from './providerCatalog';

function getSavedBaseUrl(catalogId: string | undefined, fallback?: string): string | undefined {
	return (catalogId && getCachedProvider(catalogId)?.connection.baseUrl) || fallback;
}

/**
 * AWS profile/region to pre-fill the connect dialog with, read from
 * providers.json alone rather than the resolved catalog.
 *
 * Deliberately excludes `AWS_PROFILE` / `AWS_REGION`. Whether those reach the
 * extension host depends on how Positron was launched and on a shell profile
 * nobody versions, so showing one as a saved setting would promise persistence
 * it doesn't have -- the next launch may resolve a different region with
 * nothing in the UI having changed. The form therefore shows only what the
 * user controls, and the hint beneath it names the variables as the fallback.
 */
export function getUserAwsSettings(): { profile?: string; region?: string } {
	const aws = getUserProviderBlock(PROVIDER_METADATA.amazonBedrock.catalogId!)?.aws;
	return {
		...(aws?.profile ? { profile: aws.profile } : {}),
		...(aws?.region ? { region: aws.region } : {}),
	};
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
	// This single-slot provider predates providers.custom and is superseded
	// by it (see isLegacyCustomProviderConfigured below).
	customProvider: {
		id: CUSTOM_PROVIDER_AUTH_PROVIDER_ID,
		displayName: 'OpenAI Compatible',
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

/**
 * Whether someone has connected the legacy "OpenAI Compatible" provider
 * before. A saved base URL is a reliable stand-in for that: the only way to
 * sign in is through the modal's connect form, which always saves one.
 */
export function isLegacyCustomProviderConfigured(): boolean {
	return getSavedBaseUrl(PROVIDER_METADATA.customProvider.catalogId) !== undefined;
}

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
			supportedOptions: ['toolCalls', 'aws'],
			defaults: {
				model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
				toolCalls: true,
				aws: getUserAwsSettings(),
			},
			// Structurally identical to the catalog's ConnectionProvenance, so the
			// tree passes straight through -- the catalog owns the environment seam
			// and needs no dependency on the positron API types to do it.
			overrides: getConnectionProvenance(PROVIDER_METADATA.amazonBedrock.catalogId),
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

/**
 * {@link getProviderSources} minus the legacy "OpenAI Compatible" provider
 * when nobody has configured it (providers.custom supersedes it). Use this,
 * not getProviderSources, anywhere that registers a provider or updates its
 * session, so those places can't disagree on what's actually registered.
 *
 * Kept separate from getProviderSources itself because
 * customSupportedOptions still needs to find the legacy entry by id (to copy
 * its supportedOptions for openai-compatible-kind custom entries) whether or
 * not it's configured.
 */
export function getRegistrableProviderSources(): positron.ai.LanguageModelSource[] {
	return getProviderSources().filter(source =>
		source.provider.id !== PROVIDER_METADATA.customProvider.id || isLegacyCustomProviderConfigured()
	);
}

/** One entry in a source's `supportedOptions` list. */
type SupportedOption = positron.ai.LanguageModelSource['supportedOptions'][number];

/**
 * Which built-in provider a custom entry's kind takes its form from, for the
 * kinds Positron offers (see `isOfferedCustomKind`). The field list is read from
 * that built-in's own source rather than restated, so the two can't drift.
 */
const BUILTIN_FORM_BY_KIND: Partial<Record<SupportedCustomClientKind, keyof typeof PROVIDER_METADATA>> = {
	'openai-compatible': 'customProvider',
	anthropic: 'anthropic',
	openai: 'openai',
};

/**
 * Options a custom entry never shows, whatever its built-in offers. `autoconfigure`
 * and `oauth` belong to the one built-in instance of a provider; `protocol` is the
 * API type field this work removes; `customModels` has no write path for a custom
 * entry yet, so the input would discard what the user types (#12747).
 */
const OPTIONS_NOT_FOR_CUSTOM: ReadonlySet<SupportedOption> = new Set<SupportedOption>([
	'autoconfigure', 'oauth', 'protocol', 'customModels',
]);

/** What every offered kind needs at minimum: somewhere to call, and a key. */
const BASE_OPTIONS: SupportedOption[] = ['apiKey', 'baseUrl'];

/**
 * The fields a custom entry of this kind collects: its built-in's own list,
 * minus what only the built-in can use.
 */
function customSupportedOptions(kind: string): SupportedOption[] {
	const builtinKey = BUILTIN_FORM_BY_KIND[kind as SupportedCustomClientKind];
	const builtinId = builtinKey && PROVIDER_METADATA[builtinKey].id;
	const builtin = builtinId
		? getProviderSources().find(source => source.provider.id === builtinId)
		: undefined;

	const inherited = (builtin?.supportedOptions ?? BASE_OPTIONS)
		.filter(option => !OPTIONS_NOT_FOR_CUSTOM.has(option));
	return inherited.length > 0 ? inherited : BASE_OPTIONS;
}

/**
 * Builds the model source for one `providers.custom` entry. The entry name is
 * the provider id, display name, and catalog id at once, and the scope its
 * credential is filed under in `POSITRON_CUSTOM_AUTH_PROVIDER_ID`, so the
 * credential stays derivable from the id alone.
 */
export function customProviderSource(
	provider: ResolvedProviderLike
): positron.ai.LanguageModelSource {
	return {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: provider.id,
			displayName: provider.id,
			// Lets the modal show the entry under its vendor's icon and mark it
			// custom. No maturity status: an entry is as mature as its endpoint.
			customKind: provider.clientKind,
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
 * Enabled custom entries whose kind this host can present. Apart from
 * {@link getProviderSources} because these come and go as the config file
 * changes, while the built-in list is fixed at activation. An entry of a kind
 * Positron doesn't offer is skipped rather than shown half-configured.
 */
export function getRegistrableCustomProviders(): ResolvedProviderLike[] {
	return getCachedCustomProviders()
		.filter(provider => provider.enabled && isOfferedCustomKind(provider.clientKind));
}
