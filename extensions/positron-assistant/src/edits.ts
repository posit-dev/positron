/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';

import { MD_DIR } from './constants';
import { ParticipantService } from './participants.js';

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
	// Implements the MappedEditsProvider2 interface for mapped code edits
	const editsProvider: vscode.MappedEditsProvider2 = {
		/**
		 * Provides mapped edits for code blocks in a document by sending them to a language model.
		 */
		provideMappedEdits: async function (
			request: vscode.MappedEditsRequest,
			result: vscode.MappedEditsResponseStream,
			token: vscode.CancellationToken
		): Promise<vscode.MappedEditsResult> {
			// Select the appropriate language model for the request
			const model = await getModel(request, participantService);

			// Iterate over each code block in the request
			for (const block of request.codeBlocks) {
				// Open the text document for the code block resource
				const document = await vscode.workspace.openTextDocument(block.resource);
				log.info(`Mapping edits for block in ${block.resource.toString()}`);

				const text = document.getText();

				// Stream edits from the language model
				for await (const json of mapEdit(model, text, block.code, token)) {
					const edit = JSON.parse(json) as LMTextEdit;
					log.trace(`Received edit: ${JSON.stringify(edit)}`);

					const text = document.getText();

					// Handle append edits
					if ('append' in edit) {
						const lastLine = document.lineAt(document.lineCount - 1);
						const endPosition = lastLine.range.end;
						// If the last line is empty, append directly; otherwise, add a newline
						const append = lastLine.isEmptyOrWhitespace ? edit.append : `\n${edit.append}`;
						const textEdit = vscode.TextEdit.insert(endPosition, append);
						result.textEdit(block.resource, textEdit);

						// Handle delete and replace edits
					} else if ('delete' in edit && 'replace' in edit) {
						const deleteText = edit.delete;
						const startPos = text.indexOf(deleteText);
						const startPosition = document.positionAt(startPos);
						const endPosition = document.positionAt(startPos + deleteText.length);
						const range = new vscode.Range(startPosition, endPosition);
						const textEdit = vscode.TextEdit.replace(range, edit.replace);
						result.textEdit(block.resource, textEdit);

						// Handle unexpected edit types gracefully
					} else {
						// If the edit is neither an append nor a delete/replace,
						// we skip it. This should not happen with the current
						// model prompt, but we handle it gracefully.
						log.warn('Unable to apply edit from model: ', JSON.stringify(edit));
					}
				}
			}
			// Return an empty result object as required by the interface
			return {};
		}
	};

	// Register the mapped edits provider with the VS Code chat API
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

async function* mapEdit(
	model: vscode.LanguageModelChat,
	document: string,
	block: string,
	token: vscode.CancellationToken,
) {
	// Read the system prompt for the language model from the markdown file
	const system: string = await fs.promises.readFile(`${MD_DIR}/prompts/chat/mapedit.md`, 'utf8');

	// Send a request to the language model with the document and code block
	const response = await model.sendRequest([
		vscode.LanguageModelChatMessage.User(
			JSON.stringify({ document, block })
		)
	], { modelOptions: { system } }, token);

	let hasCodeFence = false; // Tracks if a code fence has been detected
	let buffer = ''; // Buffer for accumulating streamed text
	let newlineIndex;

	// Stream the response text from the language model
	for await (const delta of response.text) {
		if (token.isCancellationRequested) {
			return null; // Stop processing if the operation is cancelled
		}
		buffer += delta;

		// Remove code fence at the start of the buffer if present
		if (!hasCodeFence && buffer.startsWith('```')) {
			const fenceEnd = buffer.indexOf('\n');
			if (fenceEnd !== -1) {
				buffer = buffer.slice(fenceEnd + 1);
				hasCodeFence = true;
			}
		}

		// Remove code fence at the end of the buffer if present
		if (hasCodeFence && buffer.endsWith('```')) {
			buffer = buffer.slice(0, buffer.length - 3);
		}

		// Yield each line as it is completed
		while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, newlineIndex);
			yield line;
			buffer = buffer.slice(newlineIndex + 1);
		}
	}
	// Yield any remaining text in the buffer
	yield buffer;
}
