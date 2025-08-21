/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';

import { MD_DIR } from '../constants';
import { PositronAssistantEditorParticipant, PositronAssistantChatContext } from '../participants.js';

export const DOC_COMMAND = 'doc';

/**
 * Handler for the custom chat participant command `/doc`.
 */
export async function docHandler(
	_request: vscode.ChatRequest,
	context: PositronAssistantChatContext,
	response: vscode.ChatResponseStream,
	_token: vscode.CancellationToken,
	handleDefault: () => Promise<vscode.ChatResult | void>
) {
	const { systemPrompt } = context;

	response.progress(vscode.l10n.t('Generating documentation...'));

	const prompt = await fs.promises.readFile(`${MD_DIR}/prompts/chat/doc.md`, 'utf8');
	context.systemPrompt = `${systemPrompt}\n\n${prompt}`;

	return handleDefault();
}

export function registerDocCommand() {
	PositronAssistantEditorParticipant.registerCommand(DOC_COMMAND, docHandler);
}
