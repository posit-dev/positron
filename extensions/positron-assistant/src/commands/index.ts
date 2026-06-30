/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { FIX_COMMAND, fixHandler } from './fix.js';
import { EXPLAIN_COMMAND, explainHandler } from './explain.js';
import { log } from '../log.js';
import {
	IChatRequestHandler,
	PositronAssistantAgentParticipant,
	PositronAssistantChatParticipant,
	PositronAssistantEditorParticipant,
	PositronAssistantEditParticipant,
	PositronAssistantNotebookParticipant,
	PositronAssistantTerminalParticipant
} from '../participants.js';
import { PromptMetadata, PromptMetadataMode, PromptRenderer } from '../promptRender.js';

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
	registerAssistantCommand(FIX_COMMAND, fixHandler);
	registerAssistantCommand(EXPLAIN_COMMAND, explainHandler);
}
