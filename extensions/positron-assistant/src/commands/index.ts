/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronAssistantChatContext } from '../participants.js';
import { registerFixCommand } from './fix.js';
import { registerQuartoCommand } from './quarto.js';

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
		context: PositronAssistantChatContext,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
	): Promise<boolean>;
}

export function registerAssistantCommands() {
	registerFixCommand();
	registerQuartoCommand();
}
