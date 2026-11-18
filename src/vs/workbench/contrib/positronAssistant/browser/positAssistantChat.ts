/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';

// Command exposed by the Posit Assistant extension to start/continue a chat.
// The key string is mirrored in the Posit Assistant extension (the two
// repositories cannot share a module).
export const POSIT_NEW_CHAT_COMMAND = 'posit-assistant.newChat';

// Context key set by the Posit Assistant extension when it has at least one
// usable chat model. Like the command ID, the string is mirrored in the
// extension.
export const POSIT_HAS_CHAT_MODELS_KEY = 'posit-assistant.hasChatModels';

/** A file attachment passed to the Posit Assistant newChat command. */
export interface NewChatFile {
	uri: string;
	name: string;
}

/** Payload for the posit-assistant.newChat command. */
export interface NewChatOptions {
	prompt: string;
	/** 'new' starts a fresh conversation; 'auto' continues the current one. */
	target: 'auto' | 'new';
	/**
	 * 'submit' sends the prompt immediately; 'prefill' replaces the input;
	 * 'append' adds the prompt and files to what's in the input.
	 */
	behavior: 'submit' | 'prefill' | 'append';
	files?: NewChatFile[];
}

/**
 * Add text and files to the input of the current Posit Assistant
 * conversation, without sending them, so the user can add more before
 * sending. A Posit Assistant without 'append' gets them as a prefilled
 * prompt instead, which replaces its input. Failures are logged and surfaced
 * as a notification rather than thrown.
 *
 * @param fallbackPrompt The prompt to prefill when there's no text and
 *   Posit Assistant can't append.
 */
export async function attachToPositAssistant(
	commandService: ICommandService,
	notificationService: INotificationService,
	logService: ILogService,
	attachment: { text?: string; files: NewChatFile[]; fallbackPrompt: string },
): Promise<void> {
	try {
		await commandService.executeCommand(POSIT_NEW_CHAT_COMMAND, {
			prompt: attachment.text ?? '',
			target: 'auto',
			behavior: 'append',
			files: attachment.files,
		} satisfies NewChatOptions);
	} catch (error) {
		// A Posit Assistant without 'append' rejects it, or first an empty
		// prompt, which only 'append' allows.
		const message = toErrorMessage(error);
		if (!message.includes('Invalid behavior') && !message.includes('prompt is required')) {
			logService.error('Failed to add to the Posit Assistant chat', error);
			notificationService.error(localize('positron.assistant.attachUnavailable', "Could not add to the Posit Assistant chat: {0}", toErrorMessage(error)));
			return;
		}
		await openPositAssistantChat(commandService, notificationService, logService, {
			prompt: attachment.text ?? attachment.fallbackPrompt,
			target: 'auto',
			behavior: 'prefill',
			files: attachment.files,
		});
	}
}

/**
 * Send a query to Posit Assistant via the standalone assistant's
 * posit-assistant.newChat command. newChat opens the assistant in whichever
 * surface the user configured (sidebar or editor panel), so callers do not
 * branch on the surface themselves. Failures are logged and surfaced as a
 * notification rather than thrown.
 */
export async function openPositAssistantChat(
	commandService: ICommandService,
	notificationService: INotificationService,
	logService: ILogService,
	options: NewChatOptions,
): Promise<void> {
	try {
		await commandService.executeCommand(POSIT_NEW_CHAT_COMMAND, options);
	} catch (error) {
		logService.error('Failed to open Posit Assistant chat', error);
		notificationService.error(
			localize(
				'positron.assistant.chatUnavailable',
				"Posit Assistant could not be opened: {0}",
				toErrorMessage(error)
			)
		);
	}
}
