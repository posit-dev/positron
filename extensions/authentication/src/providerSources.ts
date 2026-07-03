/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import {
	ANTHROPIC_AUTH_PROVIDER_ID,
	AWS_AUTH_PROVIDER_ID,
	CUSTOM_PROVIDER_AUTH_PROVIDER_ID,
	DEEPSEEK_AUTH_PROVIDER_ID,
	FOUNDRY_AUTH_PROVIDER_ID,
	GEMINI_AUTH_PROVIDER_ID,
	GOOGLE_CLOUD_AUTH_PROVIDER_ID,
	OPENAI_AUTH_PROVIDER_ID,
	POSIT_AUTH_PROVIDER_ID,
} from './constants';
import { getConfiguredSnowflakeAccount } from './snowflakeCredentials';

/**
 * Config section -> `*_BASE_URL` env var, for providers whose base URL can come
 * from the environment. A provider missing here has no env-var source.
 */
const BASE_URL_ENV_VARS: Record<string, string> = {
	'anthropic': 'ANTHROPIC_BASE_URL',
	'openai-api': 'OPENAI_BASE_URL',
	'google': 'GEMINI_BASE_URL',
	'googleVertex': 'GOOGLE_VERTEX_BASE_URL',
	'deepseek-api': 'DEEPSEEK_BASE_URL',
};

/**
 * Effective base URL for a provider, with the precedence user setting > env var
 * > fallback. A value the user set in settings (at any scope) wins; otherwise
 * the provider's `*_BASE_URL` env var is read live; otherwise the fallback. The
 * env var is never written to settings, so removing it reverts cleanly to the
 * user's setting or the fallback (#12894).
 */
export function getEffectiveBaseUrl(configSection: string, fallback?: string): string | undefined {
	const inspected = vscode.workspace
		.getConfiguration(`authentication.${configSection}`)
		.inspect<string>('baseUrl');
	const userValue = inspected?.workspaceFolderValue
		?? inspected?.workspaceValue
		?? inspected?.globalValue;
	const envVar = BASE_URL_ENV_VARS[configSection];
	const envValue = envVar ? process.env[envVar] : undefined;
	return userValue || envValue || fallback;
}

export interface ProviderMetadata {
	id: string;
	displayName: string;
	settingName: string;
	/**
	 * Maturity status of the provider, mirroring the `tags` on its
	 * `*.enable` setting. The config modal lists stable providers (no status)
	 * first, then 'preview', then 'experimental'. Providers that aren't ready
	 * yet are kept out of the modal by defaulting their `*.enable` setting to
	 * false, not by status.
	 */
	status?: 'preview' | 'experimental';
}

export const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
	anthropic: {
		id: ANTHROPIC_AUTH_PROVIDER_ID,
		displayName: 'Anthropic',
		settingName: 'anthropic',
	},
	positAI: {
		id: POSIT_AUTH_PROVIDER_ID,
		displayName: 'Posit AI',
		settingName: 'positAI',
	},
	amazonBedrock: {
		id: AWS_AUTH_PROVIDER_ID,
		displayName: 'Amazon Bedrock',
		settingName: 'amazonBedrock',
	},
	foundry: {
		id: FOUNDRY_AUTH_PROVIDER_ID,
		displayName: 'Microsoft Foundry',
		settingName: 'msFoundry'
	},
	snowflake: {
		id: 'snowflake-cortex',
		displayName: 'Snowflake Cortex',
		settingName: 'snowflakeCortex',
	},
	openai: {
		id: OPENAI_AUTH_PROVIDER_ID,
		displayName: 'OpenAI',
		settingName: 'openAI',
	},
	google: {
		id: GEMINI_AUTH_PROVIDER_ID,
		displayName: 'Google Gemini',
		settingName: 'google',
		status: 'experimental',
	},
	googleVertex: {
		id: GOOGLE_CLOUD_AUTH_PROVIDER_ID,
		displayName: 'Gemini Enterprise Agent Platform',
		settingName: 'googleVertex',
		status: 'experimental',
	},
	copilot: {
		id: 'copilot-auth',
		displayName: 'GitHub Copilot',
		settingName: 'githubCopilot',
		status: 'preview',
	},
	customProvider: {
		id: CUSTOM_PROVIDER_AUTH_PROVIDER_ID,
		displayName: 'Custom Provider',
		settingName: 'customProvider',
		status: 'experimental',
	},
	deepseek: {
		id: DEEPSEEK_AUTH_PROVIDER_ID,
		displayName: 'DeepSeek',
		settingName: 'deepseek',
		status: 'experimental',
	},
};

export function getProviderSources(): positron.ai.LanguageModelSource[] {
	// Vertex shows an autoconfigure label only when project + location come from
	// env vars. If the user supplied them via settings, the modal behaves like
	// Bedrock (no label, Sign Out button visible).
	const vertexFromEnv = !!process.env.GOOGLE_VERTEX_PROJECT
		&& !!process.env.GOOGLE_VERTEX_LOCATION;

	return [
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.anthropic,
			supportedOptions: ['apiKey', 'baseUrl', 'autoconfigure'],
			defaults: {
				model: 'claude-sonnet-4-latest',
				baseUrl: getEffectiveBaseUrl('anthropic', 'https://api.anthropic.com'),
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
				baseUrl: getEffectiveBaseUrl('foundry'),
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
				baseUrl: getConfiguredSnowflakeAccount(),
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
				baseUrl: getEffectiveBaseUrl('openai-api', 'https://api.openai.com/v1'),
				toolCalls: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.google,
			supportedOptions: ['baseUrl', 'apiKey'],
			defaults: {
				model: 'gemini-2.5-flash',
				baseUrl: getEffectiveBaseUrl('google', 'https://generativelanguage.googleapis.com/v1beta'),
				apiKey: undefined,
				toolCalls: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.googleVertex,
			// In env-var mode, omit 'baseUrl' from supportedOptions so the
			// modal renders the simple env-var-driven label without trying
			// to derive a _BASE_URL peer (the modal's derivation assumes a
			// _API_KEY suffix, which doesn't apply here).
			supportedOptions: vertexFromEnv
				? ['autoconfigure']
				: ['baseUrl', 'toolCalls'],
			defaults: {
				model: 'gemini-2.5-flash',
				baseUrl: getEffectiveBaseUrl('googleVertex', 'https://aiplatform.googleapis.com'),
				toolCalls: true,
				...(vertexFromEnv && {
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
			supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
			defaults: {
				model: 'openai-compatible',
				baseUrl: getEffectiveBaseUrl('openai-compatible', 'https://localhost:1337/v1'),
				toolCalls: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.deepseek,
			supportedOptions: ['apiKey', 'baseUrl', 'autoconfigure'],
			defaults: {
				model: 'deepseek-chat',
				baseUrl: getEffectiveBaseUrl('deepseek-api', 'https://api.deepseek.com'),
				toolCalls: true,
				autoconfigure: {
					type: positron.ai.LanguageModelAutoconfigureType.EnvVariable,
					key: 'DEEPSEEK_API_KEY',
					signedIn: false,
				},
			},
		},
	];
}
