/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { FIX_COMMAND, fixHandler } from './fix.js';
import { EXPORT_QUARTO_COMMAND, quartoHandler } from './quarto.js';
import { EXPLAIN_COMMAND, explainHandler } from './explain.js';
import { DOC_COMMAND, docHandler } from './doc.js';
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
import { PromptMetadata, PromptMetadataMode, PromptRenderer } from '../promptRender.js';

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
	let metadata: PromptMetadata<PromptMetadataMode[]>;
	try {
		metadata = PromptRenderer.getCommandMetadata(command);
	} catch (err) {
		if (err instanceof Error) {
			log.error(`Error retrieving metadata for command ${command}: ${err.message}`);
		} else {
			log.error(`Unknown error retrieving metadata for command ${command}: ${JSON.stringify(err)}`);
		}
		return;
	}
	const modes = metadata.mode ?? [];
	for (const mode of modes) {
		switch (mode) {
			case positron.PositronChatMode.Ask:
				PositronAssistantChatParticipant.registerCommand(command, handler);
				break;
			case positron.PositronChatMode.Edit:
				PositronAssistantEditParticipant.registerCommand(command, handler);
				break;
			case positron.PositronChatMode.Agent:
				PositronAssistantAgentParticipant.registerCommand(command, handler);
				break;
			case positron.PositronChatAgentLocation.Editor:
				PositronAssistantEditorParticipant.registerCommand(command, handler);
				break;
			case positron.PositronChatAgentLocation.Terminal:
				PositronAssistantTerminalParticipant.registerCommand(command, handler);
				break;
			case positron.PositronChatAgentLocation.Notebook:
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
