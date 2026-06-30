/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';

// Command exposed by the Posit Assistant extension to start/continue a chat.
// The key string is mirrored in the Posit Assistant extension (the two
// repositories cannot share a module).
export const POSIT_NEW_CHAT_COMMAND = 'posit-assistant.newChat';

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
	/** 'submit' sends the prompt immediately; 'prefill' only populates the input. */
	behavior: 'submit' | 'prefill';
	files?: NewChatFile[];
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
				"Posit Assistant could not be opened. Make sure the Posit Assistant extension is installed and enabled, and that the assistant sidebar view is turned on."
			)
		);
	}
}
