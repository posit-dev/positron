/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatConfiguration } from '../../chat/common/constants.js';

/** Setting-key prefixes that identify AI-related settings. */
export const AI_SETTING_PREFIXES: readonly string[] = [
	'ai.',
	'notebook.ai.',
	'nextEditSuggestions.',
	'assistant.',
	'positron.assistant.',
	'authentication.',
	'console.assistantActions.',
	'git.suggestions.',
	'github.copilot.',
];

/** AI-related settings that don't share one of the AI prefixes. */
export const AI_SETTING_EXACT_KEYS: readonly string[] = [ChatConfiguration.AIDisabled];

/**
 * Whether a setting key is AI-related.
 * @param key The full setting key.
 */
export function isAiSetting(key: string): boolean {
	return AI_SETTING_EXACT_KEYS.includes(key) || AI_SETTING_PREFIXES.some(prefix => key.startsWith(prefix));
}
