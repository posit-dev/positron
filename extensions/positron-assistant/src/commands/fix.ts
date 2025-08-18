/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';

import { MD_DIR } from '../constants';
import { ParticipantID, PositronAssistantChatParticipant, PositronAssistantEditorParticipant, PositronAssistantChatContext } from '../participants.js';
import { PositronAssistantToolName } from '../types.js';

export const FIX_COMMAND = 'fix';

/**
 * Handler for the custom chat participant command `/fix`.
 */
export async function fixHandler(
	_request: vscode.ChatRequest,
	context: PositronAssistantChatContext,
	response: vscode.ChatResponseStream,
	_token: vscode.CancellationToken,
	handleDefault: () => Promise<vscode.ChatResult | void>
) {
	const { systemPrompt, participantId } = context;

	if (participantId !== ParticipantID.Chat && participantId !== ParticipantID.Editor) {
		return handleDefault();
	}

	response.progress('Preparing edits...');

	if (participantId === ParticipantID.Chat) {
		const prompt = await fs.promises.readFile(`${MD_DIR}/prompts/chat/fix.md`, 'utf8');
		context.systemPrompt = `${systemPrompt}\n\n${prompt}`;
		context.toolAvailability.set(PositronAssistantToolName.ProjectTree, true);
	} else {
		const prompt = await fs.promises.readFile(`${MD_DIR}/prompts/chat/fixEditor.md`, 'utf8');
		context.systemPrompt = `${systemPrompt}\n\n${prompt}`;
	}

	return handleDefault();
}

export function registerFixCommand() {
	PositronAssistantChatParticipant.registerCommand(FIX_COMMAND, fixHandler);
	PositronAssistantEditorParticipant.registerCommand(FIX_COMMAND, fixHandler);
}
