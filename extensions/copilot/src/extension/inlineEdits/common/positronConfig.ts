/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Configuration key for Positron inline completions enable setting.
 * This has the same format as github.copilot.enable: { [languageId]: boolean }
 */
export const PositronInlineCompletionsEnableConfigKey = 'positron.assistant.inlineCompletions.enable';

/**
 * Default value for the Positron inline completions enable setting.
 */
export const PositronInlineCompletionsEnableDefault: { [key: string]: boolean } = {
	'*': true,
};
