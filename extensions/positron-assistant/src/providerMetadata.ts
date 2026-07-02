/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provider metadata definitions.
 *
 * NOTE: This metadata has been duplicated in the authentication extension
 * (`extensions/authentication/src/providerSources.ts`) as part of moving
 * provider configuration ownership there. When positron-assistant is
 * removed, this duplication will no longer exist.
 */

/**
 * Provider identity metadata used in static source blocks and settings lookups.
 */
export interface ProviderInfo {
	/**
	 * Unique provider ID for provider handling (e.g., 'anthropic-api', 'openai-api')
	 * Must be unique across all providers, even providers from other extensions, such as GitHub Copilot Chat.
	 */
	id: string;
	/**
	 * Human-readable display name for UI (e.g., 'Anthropic', 'OpenAI')
	 */
	displayName: string;
	/**
	 * Setting name used in configuration (e.g., 'anthropic', 'openAI')
	 */
	settingName: string;
	/**
	 * Optional provider-specific variables setting name (e.g., 'positron.assistant.providerVariables.bedrock')
	 * Used for providers that have additional configuration like AWS profiles/regions.
	 */
	providerVariablesSettingName?: string;
}

/**
 * Metadata for all registered providers.
 * Each provider class should import its metadata from here for its static source block.
 */
export const PROVIDER_METADATA = {
	amazonBedrock: {
		id: 'amazon-bedrock',
		displayName: 'Amazon Bedrock',
		settingName: 'amazonBedrock',
		providerVariablesSettingName: 'authentication.aws.credentials',
	},
	anthropic: {
		id: 'anthropic-api',
		displayName: 'Anthropic',
		settingName: 'anthropic',
	},
	foundry: {
		id: 'ms-foundry',
		displayName: 'Microsoft Foundry',
		settingName: 'msFoundry',
	},
	copilot: {
		id: 'copilot-auth',
		displayName: 'GitHub Copilot',
		settingName: 'githubCopilot',
	},
	customProvider: {
		id: 'openai-compatible',
		displayName: 'Custom Provider',
		settingName: 'customProvider',
	},
	echo: {
		id: 'echo',
		displayName: 'Echo',
		settingName: 'echo',
	},
	error: {
		id: 'error',
		displayName: 'Error Language Model',
		settingName: 'error',
	},
	google: {
		id: 'google',
		displayName: 'Gemini Code Assist',
		settingName: 'google',
	},
	openai: {
		id: 'openai-api',
		displayName: 'OpenAI',
		settingName: 'openAI',
	},
	positAI: {
		id: 'posit-ai',
		displayName: 'Posit AI',
		settingName: 'positAI',
	},
	snowflake: {
		id: 'snowflake-cortex',
		displayName: 'Snowflake Cortex',
		settingName: 'snowflakeCortex',
		providerVariablesSettingName: 'authentication.snowflake.credentials',
	},
} as const satisfies Record<string, ProviderInfo>;
