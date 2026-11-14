/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import '../../browser/aiSettingKeysCommand.js';

// Posit Assistant calls this command by name and reads this shape.
describe('positronAssistant.getAiSettingKeys', () => {
	it('returns the AI key prefixes and exact keys', () => {
		const handler = CommandsRegistry.getCommand('positronAssistant.getAiSettingKeys')?.handler;
		expect(handler?.(stubInterface<ServicesAccessor>())).toEqual({
			prefixes: expect.arrayContaining(['ai.', 'positron.assistant.']),
			// Can be empty: chat.disableAIFeatures, its only entry today, is being removed.
			exactKeys: expect.any(Array),
		});
	});
});
