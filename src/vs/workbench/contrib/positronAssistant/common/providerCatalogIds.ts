/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export const SETTING_NAME_TO_CATALOG_ID: ReadonlyMap<string, string> = new Map([
	['anthropic', 'anthropic'],
	['positAI', 'positai'],
	['amazonBedrock', 'bedrock'],
	['msFoundry', 'ms-foundry'],
	['snowflakeCortex', 'snowflake-cortex'],
	['openAI', 'openai'],
	['google', 'gemini'],
	['googleVertex', 'google-vertex'],
	['githubCopilot', 'copilot'],
	['customProvider', 'openai-compatible'],
	['deepseek', 'deepseek'],
]);

/**
 * Catalog provider id for a registered source's settingName, or undefined
 * for providers with no catalog entry (dev-only echo/error). Values mirror
 * the auth extension's settings -> providers.json migration table (#14928);
 * core cannot import extension code, so the two copies stay small and
 * auditable (see the counterpart catalogId fields in the auth extension's
 * PROVIDER_METADATA).
 */
export function catalogIdForSettingName(settingName: string): string | undefined {
	return SETTING_NAME_TO_CATALOG_ID.get(settingName);
}
