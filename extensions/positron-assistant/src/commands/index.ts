/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { FIX_COMMAND, fixHandler } from './fix.js';
import { EXPORT_QUARTO_COMMAND, quartoHandler } from './quarto.js';
import { EXPLAIN_COMMAND, explainHandler } from './explain.js';
import { DOC_COMMAND, docHandler } from './doc.js';
import { getCommandMetadata } from '../promptRender.js';
import { log } from '../extension.js';
import {
	PositronAssistantAgentParticipant,
	PositronAssistantChatContext,
	PositronAssistantChatParticipant,
	PositronAssistantEditorParticipant,
	PositronAssistantEditParticipant,
	PositronAssistantNotebookParticipant,
	PositronAssistantTerminalParticipant
} from '../participants.js';

/**
 * A function that handles chat requests.
 *
 * @param request The chat request to handle.
 * @param context The chat context for the request.
 * @param response The response stream for the request.
 * @param token A cancellation token for the request.
 * @param handleDefault A function to call the default request handler.
 */
export interface IChatRequestHandler {
	(
		request: vscode.ChatRequest,
		context: PositronAssistantChatContext,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
		handleDefault: () => Promise<vscode.ChatResult | void>
	): Promise<vscode.ChatResult | void>;
}

function registerAssistantCommand(command: string, handler: IChatRequestHandler) {
	const metadata = getCommandMetadata(command);
	const modes = metadata.mode ?? [];
	for (const mode of modes) {
		switch (mode) {
			case 'ask':
				PositronAssistantChatParticipant.registerCommand(command, handler);
				break;
			case 'edit':
				PositronAssistantEditParticipant.registerCommand(command, handler);
				break;
			case 'agent':
				PositronAssistantAgentParticipant.registerCommand(command, handler);
				break;
			case 'inline':
				PositronAssistantEditorParticipant.registerCommand(command, handler);
				break;
			case 'terminal':
				PositronAssistantTerminalParticipant.registerCommand(command, handler);
				break;
			case 'notebook':
				PositronAssistantNotebookParticipant.registerCommand(command, handler);
				break;
			default:
				log.trace('[commands] Unsupported command mode:', mode);
		}
	}
}

export function registerAssistantCommands() {
	registerAssistantCommand(DOC_COMMAND, docHandler);
	registerAssistantCommand(FIX_COMMAND, fixHandler);
	registerAssistantCommand(EXPLAIN_COMMAND, explainHandler);
	registerAssistantCommand(EXPORT_QUARTO_COMMAND, quartoHandler);
}
