/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';

import { EXTENSION_ROOT_DIR } from '../constants';
import { ParticipantID, PositronAssistantChatParticipant, PositronAssistantEditorParticipant, PositronAssistantChatContext } from '../participants.js';

const mdDir = `${EXTENSION_ROOT_DIR}/src/md/`;

export const FIX_COMMAND = 'fix';

interface IFixResponse {
	// The summary of the fix.
	summary: string;
	// The programming language of the code.
	language: string;
	// The fixed code.
	code: string;
	// Optional edits to apply in the editor.
	edit?: {
		// The file URI where the edit should be applied.
		uri: string;
		// The range of the edit in the file.
		range: vscode.Range;
	};
}

/**
 * Handler for the custom chat participant command `/fix`.
 */
export async function fixHandler(
	request: vscode.ChatRequest,
	context: PositronAssistantChatContext,
	response: vscode.ChatResponseStream,
	_token: vscode.CancellationToken,
	handleDefault: () => Promise<vscode.ChatResult | void>
) {
	const { systemPrompt, participantId } = context;

	if (participantId !== ParticipantID.Chat) {
		return handleDefault();
	}

	const prompt = await fs.promises.readFile(`${mdDir}/prompts/chat/fix.md`, 'utf8');
	context.systemPrompt = `${systemPrompt}\n\n${prompt}`;

	if (request.acceptedConfirmationData) {
		for (const { fixResponse } of request.acceptedConfirmationData as { fixResponse: IFixResponse }[]) {
			if (request.prompt.includes('Apply in Editor') && fixResponse.edit) {
				response.progress('Applying edits...');
				const uri = vscode.Uri.file(fixResponse.edit.uri);

				const edit = new vscode.WorkspaceEdit();
				edit.replace(uri, fixResponse.edit.range, fixResponse.code);
				const success = await vscode.workspace.applyEdit(edit);

				if (success) {
					response.markdown('Edit complete');
				} else {
					response.warning('Edits failed');
				}
			}
		}
		return;
	}

	const messages: vscode.LanguageModelChatMessage2[] = [
		vscode.LanguageModelChatMessage.User(request.prompt),
	];

	const contextInfo = await context.attachContextInfo();
	if (contextInfo?.message) {
		messages.push(contextInfo.message);
	}

	const modelResponse = await request.model.sendRequest(messages, {
		modelOptions: {
			system: context.systemPrompt
		}
	});

	let jsonResponse = '';
	for await (const chunk of modelResponse.text) {
		jsonResponse += chunk;
	}

	const fixResponse: IFixResponse = JSON.parse(jsonResponse); // throws if invalid

	const confirmationBody = new vscode.MarkdownString();
	confirmationBody.appendText(fixResponse.summary);
	confirmationBody.appendCodeblock(fixResponse.code, fixResponse.language);

	const actions = ['Run in Console'];
	if (fixResponse.edit) {
		actions.push('Apply in Editor');
	}
	response.confirmation('Suggested Fix', confirmationBody.value, { fixResponse }, actions);

	// return result;
}

export function registerFixCommand() {
	PositronAssistantChatParticipant.registerCommand(FIX_COMMAND, fixHandler);
	PositronAssistantEditorParticipant.registerCommand(FIX_COMMAND, fixHandler);
}
