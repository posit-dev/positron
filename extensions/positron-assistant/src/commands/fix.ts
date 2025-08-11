/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';

import { EXTENSION_ROOT_DIR } from '../constants';
import { ParticipantID, PositronAssistantChatParticipant, PositronAssistantEditorParticipant, PositronAssistantChatContext } from '../participants.js';
import { PositronAssistantToolName } from '../types.js';

const mdDir = `${EXTENSION_ROOT_DIR}/src/md/`;

export const FIX_COMMAND = 'fix';

/**
 * Handler for the custom chat participant command `/fix`.
 */
export async function fixHandler(
	_request: vscode.ChatRequest,
	context: PositronAssistantChatContext,
	_response: vscode.ChatResponseStream,
	_token: vscode.CancellationToken,
) {
	const { systemPrompt, participantId } = context;

	if (participantId !== ParticipantID.Chat) {
		return true;
	}

	const prompt = await fs.promises.readFile(`${mdDir}/prompts/chat/fix.md`, 'utf8');
	context.systemPrompt = `${systemPrompt}\n\n${prompt}`;
	context.toolAvailability.set(PositronAssistantToolName.ExecuteCode, true);

	return true;
}

export function registerFixCommand() {
	PositronAssistantChatParticipant.registerCommand(FIX_COMMAND, fixHandler);
	PositronAssistantEditorParticipant.registerCommand(FIX_COMMAND, fixHandler);
}
