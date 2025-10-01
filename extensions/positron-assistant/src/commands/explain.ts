/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';

import { MD_DIR } from '../constants';
import { PositronAssistantChatParticipant, PositronAssistantEditorParticipant, PositronAssistantChatContext } from '../participants.js';


export const EXPLAIN_COMMAND = 'explain';

/**
 * Handler for the custom chat participant command `/explain`.
 */
export async function explainHandler(
	_request: vscode.ChatRequest,
	context: PositronAssistantChatContext,
	_response: vscode.ChatResponseStream,
	_token: vscode.CancellationToken,
	handleDefault: () => Promise<vscode.ChatResult | void>
) {
	const defaultPrompt = await fs.promises.readFile(`${MD_DIR}/prompts/chat/default.md`, 'utf8');
	const explainPrompt = await fs.promises.readFile(`${MD_DIR}/prompts/chat/explain.md`, 'utf8');
	const warningPrompt = await fs.promises.readFile(`${MD_DIR}/prompts/chat/warning.md`, 'utf8');

	context.systemPrompt = defaultPrompt + '\n\n' + explainPrompt + '\n\n' + warningPrompt;
	return handleDefault();
}

export function registerExplainCommand() {
	PositronAssistantChatParticipant.registerCommand(EXPLAIN_COMMAND, explainHandler);
	PositronAssistantEditorParticipant.registerCommand(EXPLAIN_COMMAND, explainHandler);
}
