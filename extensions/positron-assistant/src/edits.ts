/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';

import { EXTENSION_ROOT_DIR } from './constants';
import { IPositronAssistantParticipant, ParticipantID, ParticipantService } from './participants.js';
const mdDir = `${EXTENSION_ROOT_DIR}/src/md/`;

type LMTextEdit = { append: string } | { delete: string; replace: string };

/**
 * A provider for the copilot "Apply in Editor" functionality. Send text content
 * of code blocks and documents to a Language Model to calculate how to apply
 * the code block within the document.
 */
export function registerMappedEditsProvider(
	context: vscode.ExtensionContext,
	participantService: ParticipantService,
) {
	const editsProvider: vscode.MappedEditsProvider2 = {
		provideMappedEdits: async function (
			request: vscode.MappedEditsRequest,
			result: vscode.MappedEditsResponseStream,
			token: vscode.CancellationToken
		): Promise<vscode.MappedEditsResult> {
			const model = await getModel(request.chatRequestId, participantService);

			for (const block of request.codeBlocks) {
				const document = await vscode.workspace.openTextDocument(block.resource);
				const text = document.getText();
				const json = await mapEdit(model, text, block.code, token);
				if (!json) {
					return {};
				}

				const edits = JSON.parse(json) as LMTextEdit[];
				for (const edit of edits) {
					if ('append' in edit) {
						const lastLine = document.lineAt(document.lineCount - 1);
						const endPosition = lastLine.range.end;
						const append = lastLine.isEmptyOrWhitespace ? edit.append : `\n${edit.append}`;
						const textEdit = vscode.TextEdit.insert(endPosition, append);
						result.textEdit(block.resource, textEdit);
					} else {
						const deleteText = edit.delete;
						const startPos = text.indexOf(deleteText);
						const startPosition = document.positionAt(startPos);
						const endPosition = document.positionAt(startPos + deleteText.length);
						const range = new vscode.Range(startPosition, endPosition);
						const textEdit = vscode.TextEdit.replace(range, edit.replace);
						result.textEdit(block.resource, textEdit);
					}
				}
			}
			return {};
		}
	};

	context.subscriptions.push(
		vscode.chat.registerMappedEditsProvider2(editsProvider)
	);
}

async function getModel(
	chatRequestId: string | undefined,
	participantService: ParticipantService,
): Promise<vscode.LanguageModelChat> {
	// Check if there is an open chat request and use its model.
	if (chatRequestId) {
		const data = participantService.getRequestData(chatRequestId);
		if (data?.request?.model) {
			return data.request.model;
		}
	}

	// Fall back to the first available model.
	const models = await vscode.lm.selectChatModels();
	if (models.length === 0) {
		throw new Error('No language models available for mapped edit');
	}
	return models[0];
}

async function mapEdit(
	model: vscode.LanguageModelChat,
	document: string,
	block: string,
	token: vscode.CancellationToken,
): Promise<string | null> {
	const system: string = await fs.promises.readFile(`${mdDir}/prompts/chat/mapedit.md`, 'utf8');
	const response = await model.sendRequest([
		vscode.LanguageModelChatMessage.User(
			JSON.stringify({ document, block })
		)
	], { modelOptions: { system } }, token);

	let replacement = '';
	for await (const delta of response.text) {
		if (token.isCancellationRequested) {
			return null;
		}
		replacement += delta;
	}

	// The model is instructed in `mapedit.md` to return the result as plain
	// JSON. Despite these instructions, it has been known to return the JSON
	// inside a Markdown code fence. If it does, we need to extract the JSON
	// content from it so it can be parsed correctly.
	const jsonStart = replacement.indexOf('```json');
	if (jsonStart !== -1) {
		const jsonEnd = replacement.indexOf('```', jsonStart + 6);
		if (jsonEnd !== -1) {
			replacement = replacement.substring(jsonStart + 6, jsonEnd).trim();
		} else {
			// If the closing code fence is missing, we return the whole content after the opening code fence.
			replacement = replacement.substring(jsonStart + 6).trim();
		}
	} else {
		// If no code fence is found, we assume the model returned plain JSON.
		replacement = replacement.trim();
	}
	return replacement;
}
