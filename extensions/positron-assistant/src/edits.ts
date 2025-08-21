/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { IPositronAssistantParticipant, ParticipantID, ParticipantService } from './participants.js';
import { PromptRenderer, MapEditContent } from './prompts';

type LMTextEdit = { append: string } | { delete: string; replace: string };

/**
 * A provider for the copilot "Apply in Editor" functionality. Send text content
 * of code blocks and documents to a Language Model to calculate how to apply
 * the code block within the document.
 */
export function registerMappedEditsProvider(
	context: vscode.ExtensionContext,
	participantService: ParticipantService,
	log: vscode.LogOutputChannel
) {
	const editsProvider: vscode.MappedEditsProvider2 = {
		provideMappedEdits: async function (
			request: vscode.MappedEditsRequest,
			result: vscode.MappedEditsResponseStream,
			token: vscode.CancellationToken
		): Promise<vscode.MappedEditsResult> {
			const model = await getModel(request, participantService);

			for (const block of request.codeBlocks) {
				const document = await vscode.workspace.openTextDocument(block.resource);
				log.info(`Mapping edits for block in ${block.resource.toString()}`);
				const text = document.getText();
				const json = await mapEdit(model, text, block.code, token);
				if (!json) {
					return {};
				}

				let edits = JSON.parse(json) as LMTextEdit[];

				// When the model returns a single edit, it may forget to wrap
				// it in an array. Tolerate this by ensuring edits is always an
				// array.
				if (!Array.isArray(edits)) {
					edits = [edits];
				}

				for (const edit of edits) {
					if ('append' in edit) {
						const lastLine = document.lineAt(document.lineCount - 1);
						const endPosition = lastLine.range.end;
						const append = lastLine.isEmptyOrWhitespace ? edit.append : `\n${edit.append}`;
						const textEdit = vscode.TextEdit.insert(endPosition, append);
						result.textEdit(block.resource, textEdit);
					} else if ('delete' in edit && 'replace' in edit) {
						const deleteText = edit.delete;
						const startPos = text.indexOf(deleteText);
						const startPosition = document.positionAt(startPos);
						const endPosition = document.positionAt(startPos + deleteText.length);
						const range = new vscode.Range(startPosition, endPosition);
						const textEdit = vscode.TextEdit.replace(range, edit.replace);
						result.textEdit(block.resource, textEdit);
					} else {
						// If the edit is neither an append nor a delete/replace,
						// we skip it. This should not happen with the current
						// model prompt, but we handle it gracefully.
						log.warn('Unable to apply edit from model: ', JSON.stringify(edit));
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
	request: vscode.MappedEditsRequest,
	participantService: ParticipantService,
): Promise<vscode.LanguageModelChat> {
	// Check for a specific model ID in the request.
	if (request.chatRequestModel) {
		const models = await vscode.lm.selectChatModels({ 'id': request.chatRequestModel });
		if (models && models.length > 0) {
			return models[0];
		}
	}

	// Check if there is a current chat session and use its model.
	if (request.chatSessionId) {
		const sessionModelId = participantService.getSessionModel(request.chatSessionId);
		if (sessionModelId) {
			const models = await vscode.lm.selectChatModels({ 'id': sessionModelId });
			if (models && models.length > 0) {
				return models[0];
			}
		}
	}

	// Check if there is an open chat request and use its model.
	if (request.chatRequestId) {
		const data = participantService.getRequestData(request.chatRequestId);
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
	const systemPrompt = await PromptRenderer.renderSystemPrompt(MapEditContent, {}, model);
	const response = await model.sendRequest([
		vscode.LanguageModelChatMessage.User(
			JSON.stringify({ document, block })
		)
	], { modelOptions: { system: systemPrompt } }, token);

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
