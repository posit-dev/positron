/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';

import { EXTENSION_ROOT_DIR } from '../constants';
import { PositronAssistantChatParticipant } from '../participants.js';
import { ChatRequestParticipantOptions } from './index.js';
import { PositronAssistantToolName } from '../types.js';

const mdDir = `${EXTENSION_ROOT_DIR}/src/md/`;

export const FIX_COMMAND = 'fix';

/**
 * Handler for the custom chat participant command `/fix`.
 */
export async function fixHandler(
	_request: vscode.ChatRequest,
	_context: vscode.ChatContext,
	_response: vscode.ChatResponseStream,
	_token: vscode.CancellationToken,
	participantContext: ChatRequestParticipantOptions
) {
	const system = participantContext.systemPrompt;
	const prompt = await fs.promises.readFile(`${mdDir}/prompts/chat/fix.md`, 'utf8');

	participantContext.systemPrompt = system ? `${system}\n\n${prompt}` : prompt;

	participantContext.allowedTools.add(PositronAssistantToolName.ExecuteCode);

	return true;
}

PositronAssistantChatParticipant.registerCommand(FIX_COMMAND, fixHandler);
