/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { AI_SETTING_EXACT_KEYS, AI_SETTING_PREFIXES } from '../common/aiSettingKeys.js';

export const GET_AI_SETTING_KEYS_COMMAND_ID = 'positronAssistant.getAiSettingKeys';

// Lets Posit Assistant use this list instead of keeping its own copy.
// Not gated on ai.enabled: it only returns key names.
CommandsRegistry.registerCommand({
	id: GET_AI_SETTING_KEYS_COMMAND_ID,
	handler: () => ({ prefixes: AI_SETTING_PREFIXES, exactKeys: AI_SETTING_EXACT_KEYS }),
	metadata: {
		description: localize(
			'positron.assistant.getAiSettingKeys.description',
			"Get the setting keys Positron treats as AI-related, the same ones \"AI: Create Diagnostic Report\" lists."
		),
		returns: 'An object with prefixes, the setting-key prefixes that mark a setting as AI-related, and exactKeys, AI-related setting keys that do not share one of those prefixes. A key is AI-related when it equals an entry in exactKeys or starts with an entry in prefixes.',
	},
});
