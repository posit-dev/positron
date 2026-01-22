/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export function mock<T>(obj: Partial<T>): T {
	return obj as T;
}

/**
 * Shared test provider definitions for use across test files.
 * Each provider has the minimal structure needed for mocking getModelProviders().
 */
export const TEST_PROVIDERS = [
	{
		source: {
			provider: {
				id: 'anthropic-api',
				displayName: 'Anthropic',
				settingName: 'anthropic'
			}
		}
	},
	{
		source: {
			provider: {
				id: 'copilot-auth',
				displayName: 'GitHub Copilot',
				settingName: 'githubCopilot'
			}
		}
	},
	{
		source: {
			provider: {
				id: 'openai-api',
				displayName: 'OpenAI',
				settingName: 'openAI'
			}
		}
	},
	{
		source: {
			provider: {
				id: 'azure',
				displayName: 'Azure',
				settingName: 'azure'
			}
		}
	}
];
