/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import product from '../../../platform/product/common/product.js';
import { isObject } from '../../../base/common/types.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { ITextResourceConfigurationService } from './textResourceConfiguration.js';
import { URI } from '../../../base/common/uri.js';

// --- Start Positron ---
// Positron's main AI switch. When off, all AI features (inline completions
// included) are off, regardless of `github.copilot.enable`. Defined as a literal
// because the editor layer can't import the workbench-level `AI_ENABLED_KEY`.
const AI_ENABLED_SETTING = 'ai.enabled';
// --- End Positron ---

/**
 * Get the completions enablement setting name from product configuration.
 */
function getCompletionsEnablementSettingName(): string | undefined {
	return product.defaultChatAgent?.completionsEnablementSetting;
}

/**
 * Checks if completions (e.g., Copilot) are enabled for a given language ID
 * using `IConfigurationService`.
 *
 * @param configurationService The configuration service to read settings from.
 * @param modeId The language ID to check. Defaults to '*' which checks the global setting.
 * @returns `true` if completions are enabled for the language, `false` otherwise.
 */
export function isCompletionsEnabled(configurationService: IConfigurationService, modeId: string = '*'): boolean {
	// --- Start Positron ---
	if (configurationService.getValue(AI_ENABLED_SETTING) === false) {
		return false; // main AI switch off
	}
	// --- End Positron ---
	const settingName = getCompletionsEnablementSettingName();
	if (!settingName) {
		return false;
	}

	return isCompletionsEnabledFromObject(
		configurationService.getValue<Record<string, boolean>>(settingName),
		modeId
	);
}

/**
 * Checks if completions (e.g., Copilot) are enabled for a given language ID
 * using `ITextResourceConfigurationService`.
 *
 * @param configurationService The text resource configuration service to read settings from.
 * @param modeId The language ID to check. Defaults to '*' which checks the global setting.
 * @returns `true` if completions are enabled for the language, `false` otherwise.
 */
export function isCompletionsEnabledWithTextResourceConfig(configurationService: ITextResourceConfigurationService, resource: URI, modeId: string = '*'): boolean {
	// --- Start Positron ---
	if (configurationService.getValue<boolean>(resource, AI_ENABLED_SETTING) === false) {
		return false; // main AI switch off
	}
	// --- End Positron ---
	const settingName = getCompletionsEnablementSettingName();
	if (!settingName) {
		return false;
	}

	// Pass undefined as resource to get the global setting
	return isCompletionsEnabledFromObject(
		configurationService.getValue<Record<string, boolean>>(resource, settingName),
		modeId
	);
}

/**
 * Checks if completions are enabled for a given language ID using a pre-fetched
 * completions enablement object.
 *
 * @param completionsEnablementObject The object containing per-language enablement settings.
 * @param modeId The language ID to check. Defaults to '*' which checks the global setting.
 * @returns `true` if completions are enabled for the language, `false` otherwise.
 */
export function isCompletionsEnabledFromObject(completionsEnablementObject: Record<string, boolean> | undefined, modeId: string = '*'): boolean {
	if (!isObject(completionsEnablementObject)) {
		return false; // default to disabled if setting is not available
	}

	if (typeof completionsEnablementObject[modeId] !== 'undefined') {
		return Boolean(completionsEnablementObject[modeId]); // go with setting if explicitly defined
	}

	return Boolean(completionsEnablementObject['*']); // fallback to global setting otherwise
}
