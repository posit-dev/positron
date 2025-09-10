/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';

import { MD_DIR } from './constants';
import { IPositronAssistantParticipant, ParticipantID, ParticipantService } from './participants.js';

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
				let lastTime = Date.now();
				const logTime = () => {
					const now = Date.now();
					const diff = now - lastTime;
					lastTime = now;
					log.info(`Time since last edit: ${diff}ms`);
				};
				for await (const json of mapEdit(model, text, block.code, token, log)) {
					logTime();
					const edit = JSON.parse(json) as LMTextEdit;
					log.trace(`Received edit: ${JSON.stringify(edit)}`);

					const text = document.getText();
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

async function* mapEdit(
	model: vscode.LanguageModelChat,
	document: string,
	block: string,
	token: vscode.CancellationToken,
	log: vscode.LogOutputChannel
) {
	const system: string = await fs.promises.readFile(`${MD_DIR}/prompts/chat/mapedit.md`, 'utf8');
	const response = await model.sendRequest([
		vscode.LanguageModelChatMessage.User(
			JSON.stringify({ document, block })
		)
	], { modelOptions: { system } }, token);

	let hasCodeFence = false;
	let buffer = '';
	let newlineIndex;

	const { logTime, getAverage } = getLogTime(log);
	for await (const delta of response.text) {
		logTime();
		if (token.isCancellationRequested) {
			return null;
		}
		buffer += delta;
		// Remove code fence if present at the start of the buffer
		if (!hasCodeFence && buffer.startsWith('```')) {
			const fenceEnd = buffer.indexOf('\n');
			if (fenceEnd !== -1) {
				buffer = buffer.slice(fenceEnd + 1);
				hasCodeFence = true;
			}
		}

		// Remove code fence if present at the end of the buffer
		if (hasCodeFence && buffer.endsWith('```')) {
			buffer = buffer.slice(0, buffer.length - 3);
		}

		while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, newlineIndex);
			log.info(`Average time between deltas: ${getAverage()}ms`);
			yield line;
			buffer = buffer.slice(newlineIndex + 1);
		}
	}
	yield buffer;

	log.info(`Average time between deltas: ${getAverage()}ms`);
	return null;
}

const getLogTime = ((log: vscode.LogOutputChannel) => {
	let lastTime = Date.now();
	const diffs: number[] = [];
	const logTime = () => {
		const now = Date.now();
		const diff = now - lastTime;
		lastTime = now;
		diffs.push(diff);
		return diff;
	};
	return { logTime, getAverage: () => diffs.length > 0 ? diffs.reduce((a, b) => a + b) / diffs.length : 0 };
});
