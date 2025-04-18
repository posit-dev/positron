/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as fs from 'fs';

import { EXTENSION_ROOT_DIR } from '../constants';
import { arrayBufferToBase64, BinaryMessageReferences, toLanguageModelChatMessage } from '../utils';
import { PositronAssistantToolName } from '../tools.js';

const mdDir = `${EXTENSION_ROOT_DIR}/src/md/`;

/**
 * Handler for the default chat participant when no command has been issued. This handler is the
 * default path for LLM chat and must be able to handle a wide variety of user input.
 */
export async function defaultHandler(
	request: vscode.ChatRequest,
	context: vscode.ChatContext,
	response: vscode.ChatResponseStream,
	token: vscode.CancellationToken
) {
	// System prompt
	let system = await fs.promises.readFile(`${mdDir}/prompts/chat/default.md`, 'utf8');

	// Define more readable variables for filtering tools.
	const inChatPane = request.location2 === undefined;
	const inEditor = request.location2 instanceof vscode.ChatRequestEditorData;
	const hasSelection = inEditor && request.location2.selection?.isEmpty === false;

	// List of tools for use by the Language Model
	const toolOptions: Record<string, any> = {};
	const tools: vscode.LanguageModelChatTool[] = [
		...vscode.lm.tools.filter(tool => {
			// Ignore tools that are not applicable for the Positron Assistant
			if (!tool.tags.includes('positron-assistant')) {
				return false;
			}
			// Only include the execute code tool in the Chat pane; the other
			// panes do not have an affordance for confirming executions.
			//
			// CONSIDER: It would be better for us to introspect the tool itself
			// to see if it requires confirmation, but that information isn't
			// currently exposed in `vscode.LanguageModelChatTool`.
			if (tool.name === PositronAssistantToolName.ExecuteCode && !inChatPane) {
				return false;
			}

			// Only include the documentEdit tool in an editor and if there is
			// no selection.
			if (tool.name === PositronAssistantToolName.DocumentEdit && (!inEditor || hasSelection)) {
				return false;
			}

			// Only include the selectionEdit tool in an editor and if there is
			// a selection.
			if (tool.name === PositronAssistantToolName.SelectionEdit && (!inEditor || !hasSelection)) {
				return false;
			}

			return true;
		}),
	];

	// Binary references for use by the Language Model
	const binaryReferences: BinaryMessageReferences = {};

	// Start the list of messages to send to the Language Model with the persisted chat history.
	// Transient messages are appended next, but not stored in the history for future use.
	let messages: vscode.LanguageModelChatMessage[] = toLanguageModelChatMessage(context.history);

	// Add Positron specific context
	const positronContext = await positron.ai.getPositronChatContext(request);
	messages.push(...[
		vscode.LanguageModelChatMessage.User(JSON.stringify(positronContext)),
		vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
	]);

	// If the workspace has an llms.txt document, add it's current value to the message thread.
	if (vscode.workspace.workspaceFolders) {
		const fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, `llms.txt`);
		const fileExists = await vscode.workspace.fs.stat(fileUri).then(() => true, () => false);
		if (fileExists) {
			const llmsDocument = await vscode.workspace.openTextDocument(fileUri);
			const fileContent = llmsDocument.getText();
			if (fileContent.trim() !== '') {
				messages = [
					vscode.LanguageModelChatMessage.User(fileContent),
					vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
					...messages
				];
				// Add the file as a reference in the response.
				response.reference(fileUri);
			}
		}
	}

	// If the user has explicitly attached files as context, add them to the message thread.
	// Store binary references to be passed as a Language Model option and referenced later.
	if (request.references.length > 0) {
		const attachmentsText = await fs.promises.readFile(`${mdDir}/prompts/chat/attachments.md`, 'utf8');
		const textParts: vscode.LanguageModelTextPart[] = [
			new vscode.LanguageModelTextPart(attachmentsText)
		];

		for (const reference of request.references) {
			const value = reference.value as vscode.Uri | vscode.Location | vscode.ChatReferenceBinaryData;
			if ('uri' in value) {
				const location = (reference.value as vscode.Location);
				const description = reference.modelDescription;
				const document = await vscode.workspace.openTextDocument(location.uri);
				const documentText = document.getText();
				const selectionText = document.getText(location.range);
				const ref = {
					id: reference.id,
					uri: location.uri.toString(),
					description,
					documentText,
					selectionText,
				};
				textParts.push(new vscode.LanguageModelTextPart(`\n\n${JSON.stringify(ref)}`));
				// Add the file as a reference in the response.
				// Although the reference includes a range, we provide the full document text as context
				// and can't distinguish which part the model uses, so we don't include the range in the
				// response reference.
				response.reference(location.uri);
			} else if (reference.id.startsWith('file://')) {
				const uri = (reference.value as vscode.Uri);
				const document = await vscode.workspace.openTextDocument(uri);
				const documentText = document.getText();
				const ref = { id: reference.id, uri: uri.toString(), documentText };
				textParts.push(new vscode.LanguageModelTextPart(`\n\n${JSON.stringify(ref)}`));
				// Add the file as a reference in the response.
				response.reference(uri);
			} else if ('mimeType' in value) {
				const binaryValue = value as vscode.ChatReferenceBinaryData;
				const data = await binaryValue.data();
				binaryReferences[reference.id] = {
					data: arrayBufferToBase64(data),
					mimeType: binaryValue.mimeType,
				};
				textParts.push(new vscode.LanguageModelTextPart(`<<referenceBinary:${reference.id}>>`));
			}
		}

		messages.push(...[
			vscode.LanguageModelChatMessage.User(textParts),
			vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
		]);
	}

	// When invoked from the editor, add document and selection context
	if (request.location2 instanceof vscode.ChatRequestEditorData) {
		const document = request.location2.document;
		const selection = request.location2.selection;
		const selectedText = document.getText(selection);
		const hasSelection = selection && !selection.isEmpty;
		if (hasSelection) {
			// If the user has selected text, generate a new version of the selection.
			system += await fs.promises.readFile(`${mdDir}/prompts/chat/selection.md`, 'utf8');
		} else {
			// If the user has not selected text, use the prompt for the whole document.
			system += await fs.promises.readFile(`${mdDir}/prompts/chat/editor.md`, 'utf8');
		}
		const documentText = document.getText();
		const ref = {
			id: document.uri.toString(),
			documentText,
			selectedText,
			line: selection.active.line + 1, // 1-based line numbering for the model
			column: selection.active.character,
			documentOffset: document.offsetAt(selection.active)
		};
		const textParts: vscode.LanguageModelTextPart[] = [
			new vscode.LanguageModelTextPart(`\n\n${JSON.stringify(ref)}`)
		];
		messages.push(vscode.LanguageModelChatMessage.User(textParts));
		messages.push(
			vscode.LanguageModelChatMessage.Assistant('Acknowledged.')
		);
	}

	// When invoked from the terminal, add additional instructions.
	if (request.location === vscode.ChatLocation.Terminal) {
		system += await fs.promises.readFile(`${mdDir}/prompts/chat/terminal.md`, 'utf8');
	}

	// User prompt
	messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

	if (!request.model) {
		const commandUri = vscode.Uri.parse('command:positron.assistant.addModelConfiguration');
		const modelsMessage = vscode.l10n.t('No language models are available.');
		const addMessage = vscode.l10n.t('Click here to add one.');
		const message = new vscode.MarkdownString(`${modelsMessage} [${addMessage}](${commandUri})`);
		message.isTrusted = { enabledCommands: ['positron.assistant.addModelConfiguration'] };
		response.warning(message);
		return;
	}

	// Send messages to selected language model and stream back responses
	async function streamResponse(messages: vscode.LanguageModelChatMessage[]) {
		const modelResponse = await request.model.sendRequest(messages, {
			tools,
			modelOptions: {
				toolInvocationToken: request.toolInvocationToken,
				toolOptions,
				binaryReferences,
				system
			},
		}, token);

		const textResponses: vscode.LanguageModelTextPart[] = [];
		const toolRequests: vscode.LanguageModelToolCallPart[] = [];
		const toolResponses: Record<string, vscode.LanguageModelToolResult> = {};

		for await (const chunk of modelResponse.stream) {
			if (token.isCancellationRequested) {
				break;
			}

			if (chunk instanceof vscode.LanguageModelTextPart) {
				textResponses.push(chunk);
				response.markdown(chunk.value);
			} else if (chunk instanceof vscode.LanguageModelToolCallPart) {
				toolRequests.push(chunk);
			}
		}

		// If we do have tool requests to follow up on, use vscode.lm.invokeTool recursively
		if (toolRequests.length > 0) {
			for await (const req of toolRequests) {
				const result = await vscode.lm.invokeTool(req.name, {
					input: req.input,
					toolInvocationToken: request.toolInvocationToken
				});
				toolResponses[req.callId] = result;
			}

			const newHistory = [
				...messages,
				vscode.LanguageModelChatMessage.Assistant(textResponses),
				vscode.LanguageModelChatMessage.Assistant(toolRequests),
				vscode.LanguageModelChatMessage.User(
					Object.entries(toolResponses).map(([id, resp]) => {
						return new vscode.LanguageModelToolResultPart(id, resp.content);
					})
				),
			];

			return streamResponse(newHistory);
		}
	}

	await streamResponse(messages);

	return {
		metadata: {
			modelId: request.model.id
		},
	};
}
