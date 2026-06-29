/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { AskAssistantAction, openAssistantChat } from '../../browser/AskAssistantAction.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

/**
 * The Ask Assistant action is gated on the AI main switch (`config.ai.enabled`).
 * The menu `when` clause hides the editor toolbar button, but the action also
 * sets `f1: true`, so it gets a command palette entry whose visibility is driven
 * by the action's `precondition`. Without a precondition the command stayed in
 * the palette (and runnable) even with AI disabled, so assert both gates.
 */
describe('AskAssistantAction', () => {
	const desc = new AskAssistantAction().desc;

	it('gates the command palette entry and execution via precondition', () => {
		expect(desc.precondition?.serialize()).toBe('config.ai.enabled');
	});

	it('gates the editor toolbar button via the menu when clause', () => {
		const menu = Array.isArray(desc.menu) ? desc.menu[0] : desc.menu;
		expect(menu?.when?.serialize()).toContain('config.ai.enabled');
	});
});

/**
 * The panel actions route to the standalone Posit Assistant via posit-assistant.newChat
 * (issue #14541). Pin the command id and payload so a regression to the inert built-in
 * chat, or a dropped payload field, fails loudly.
 */
describe('openAssistantChat', () => {
	it('routes the query to the Posit Assistant newChat command', async () => {
		const executeCommand = vi.fn().mockResolvedValue(undefined);
		const commandService = stubInterface<ICommandService>({ executeCommand });
		const notificationService = stubInterface<INotificationService>({ error: vi.fn() });

		await openAssistantChat(commandService, notificationService, new NullLogService(), 'Explain this notebook');

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

		await openAssistantChat(commandService, notificationService, new NullLogService(), 'Explain this notebook');

		expect(error).toHaveBeenCalledOnce();
	});
});
