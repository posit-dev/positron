/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { openPositAssistantChat } from '../../browser/positAssistantChat.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

/**
 * All three assistant entry points (notebook panel, notebook cell quick-fix, console
 * quick-fix) route through this helper to the standalone Posit Assistant via
 * posit-assistant.newChat (issue #14541). Pin the command id and payload so a regression
 * to the inert built-in chat, or a dropped payload field, fails loudly.
 */
describe('openPositAssistantChat', () => {
	it('forwards the options to the Posit Assistant newChat command', async () => {
		const executeCommand = vi.fn().mockResolvedValue(undefined);
		const commandService = stubInterface<ICommandService>({ executeCommand });
		const notificationService = stubInterface<INotificationService>({ error: vi.fn() });

		await openPositAssistantChat(commandService, notificationService, new NullLogService(), {
			prompt: 'Explain this notebook',
			target: 'new',
			behavior: 'submit',
		});

		expect(executeCommand).toHaveBeenCalledWith('posit-assistant.newChat', {
			prompt: 'Explain this notebook',
			target: 'new',
			behavior: 'submit',
		});
	});

	it('notifies the user when the assistant command fails', async () => {
		const executeCommand = vi.fn().mockRejectedValue(new Error('Posit Assistant is disabled.'));
		const error = vi.fn();
		const commandService = stubInterface<ICommandService>({ executeCommand });
		const notificationService = stubInterface<INotificationService>({ error });

		await openPositAssistantChat(commandService, notificationService, new NullLogService(), {
			prompt: 'Explain this notebook',
			target: 'new',
			behavior: 'submit',
		});

		// The helper's job on this path is to surface the localized unavailable message,
		// not just to call error() with anything -- pin the message so a regression to an
		// empty or raw-error string fails.
		expect(error).toHaveBeenCalledWith(expect.stringMatching(/Posit Assistant is not available/));
	});
});
