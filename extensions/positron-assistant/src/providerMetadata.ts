/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provider metadata definitions.
 *
 * This file is the single source of truth for provider identity metadata (id, displayName,
 * settingName). It exists to break a circular dependency:
 *
 * - modelDefinitions.ts and modelResolutionHelpers.ts need providerId → settingName mapping
 * - Previously they imported from providerMigration.ts which imports providers/index.ts
 * - providers/index.ts imports provider classes which extend ModelProvider
 * - ModelProvider imports from modelDefinitions.ts → circular dependency
 *
 * By defining provider metadata here, both the provider classes and the helper functions
 * can import from this single source without creating a cycle.
 *
 * When adding a new provider:
 * 1. Add its metadata to PROVIDER_METADATA below
 * 2. Import and use that metadata in the provider's static source block
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
	},
	anthropic: {
		id: 'anthropic-api',
		displayName: 'Anthropic',
		settingName: 'anthropic',
	},
	azure: {
		id: 'azure',
		displayName: 'Azure',
		settingName: 'azure',
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
	},
} as const satisfies Record<string, ProviderInfo>;

/**
 * Get the setting name for a provider ID.
 *
 * @param providerId - The provider ID (e.g., 'anthropic-api', 'openai-api')
 * @returns The setting name (e.g., 'anthropic', 'openAI') or undefined if not found
 */
export function getSettingNameForProvider(providerId: string): string | undefined {
	for (const metadata of Object.values(PROVIDER_METADATA)) {
		if (metadata.id === providerId) {
			return metadata.settingName;
		}
	}
	return undefined;
}
