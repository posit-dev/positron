/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** Options about the participant modifiable by the chat request handler. */
export interface ChatRequestParticipantOptions {
	/** The system prompt to use for the participant. */
	systemPrompt: string;

	/** The tools allowed for the participant. */
	allowedTools: Set<string>;
}

/**
 * A function that handles chat requests.
 *
 * @param request The chat request to handle.
 * @param context The chat context for the request.
 * @param response The response stream for the request.
 * @param token A cancellation token for the request.
 * @param participantOptions The modifiable options for the chat participant.
 * @returns A promise that resolves when the request is handled. True if the request should continued by the default handler, false otherwise.
 */
export interface ChatRequestHandler {
	(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
		participantOptions: ChatRequestParticipantOptions
	): Promise<boolean>;
}
