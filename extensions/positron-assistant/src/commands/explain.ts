/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';

import { MD_DIR } from '../constants';
import { ParticipantID, PositronAssistantChatParticipant, PositronAssistantEditorParticipant, PositronAssistantChatContext } from '../participants.js';


export const EXPLAIN_COMMAND = 'explain';

/**
 * Handler for the custom chat participant command `/fix`.
 */
export async function explainHandler(
	_request: vscode.ChatRequest,
	context: PositronAssistantChatContext,
	_response: vscode.ChatResponseStream,
	_token: vscode.CancellationToken,
	handleDefault: () => Promise<vscode.ChatResult | void>
) {
	context.systemPrompt = await fs.promises.readFile(`${MD_DIR}/prompts/chat/explain.md`, 'utf8');

	return handleDefault();
}

export function registerExplainCommand() {
	PositronAssistantChatParticipant.registerCommand(EXPLAIN_COMMAND, explainHandler);
	PositronAssistantEditorParticipant.registerCommand(EXPLAIN_COMMAND, explainHandler);
}
