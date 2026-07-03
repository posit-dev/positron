/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParticipantService } from './participants.js';

/**
 * Get the chat request data for a given tool invocation token.
 *
 * @param chatRequestId The ID of the chat request.
 * @param participants The participants in the chat.
 * @returns The request data for the given tool invocation token.
 * @throws Error if there is no tool invocation token or if the request data cannot be found.
 */
export function getChatRequestData(
	chatRequestId: string | undefined,
	participantService: ParticipantService,
) {
	if (!chatRequestId) {
		throw new Error('This tool requires the chat request ID.');
	}

	const requestData = participantService.getRequestData(chatRequestId);
	if (!requestData) {
		throw new Error('This tool can only be invoked from a Positron Assistant chat request.');
	}

	return requestData;
}
