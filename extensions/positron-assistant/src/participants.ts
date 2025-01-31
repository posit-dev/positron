/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as fs from 'fs';

import { EXTENSION_ROOT_DIR } from './constants';
import { arrayBufferToBase64, BinaryMessageReferences, toLanguageModelChatMessage } from './utils';
import { getStoredModels } from './config';
import { executeToolAdapter, getPlotToolAdapter, positronToolAdapters, textEditToolAdapter } from './tools';
const mdDir = `${EXTENSION_ROOT_DIR}/src/md/`;

class PositronAssistantParticipant implements positron.ai.ChatParticipant {
	readonly id = 'positron.positron-assistant';
	readonly iconPath = new vscode.ThemeIcon('positron-posit-logo');
	readonly agentData: positron.ai.ChatAgentData = {
		id: this.id,
		name: 'positron-assistant',
		metadata: { isSticky: false },
		fullName: 'Positron Assistant',
		isDefault: true,
		slashCommands: [{
			name: 'quarto',
			description: 'Convert the conversation so far into a new Quarto document.'
		}],
		locations: ['panel', 'terminal', 'editor', 'notebook'],
		disambiguation: []
	};

	readonly _receiveFeedbackEventEmitter = new vscode.EventEmitter<vscode.ChatResultFeedback>();
	onDidReceiveFeedback: vscode.Event<vscode.ChatResultFeedback> = this._receiveFeedbackEventEmitter.event;

	readonly _performActionEventEmitter = new vscode.EventEmitter<vscode.ChatUserActionEvent>();
	onDidPerformAction: vscode.Event<vscode.ChatUserActionEvent> = this._performActionEventEmitter.event;

	readonly followupProvider: vscode.ChatFollowupProvider = {
		async provideFollowups(result: vscode.ChatResult, context: vscode.ChatContext, token: vscode.CancellationToken): Promise<vscode.ChatFollowup[]> {
			const system: string = await fs.promises.readFile(`${mdDir}/prompts/chat/followups.md`, 'utf8');
			const messages: vscode.LanguageModelChatMessage[] = toLanguageModelChatMessage(context.history);
			messages.push(vscode.LanguageModelChatMessage.User('Summarise and suggest follow-ups.'));

			const models = await vscode.lm.selectChatModels({ id: result.metadata?.modelId });
			if (models.length === 0) {
				throw new Error('Selected model not available.');
			}

			const response = await models[0].sendRequest(messages, { modelOptions: { system } }, token);

			let json = '';
			for await (const fragment of response.text) {
				json += fragment;
				if (token.isCancellationRequested) {
					break;
				}
			}

			try {
				return (JSON.parse(json) as 'string'[]).map((p) => ({ prompt: p }));
			} catch (e) {
				return [];
			}
		}
	};

	readonly welcomeMessageProvider = {
		async provideWelcomeMessage(token: vscode.CancellationToken) {
			let welcomeText = await fs.promises.readFile(`${mdDir}/welcome.md`, 'utf8');

			// Show an extra configuration link if there are no configured models yet
			if (getStoredModels().length === 0) {
				const commandUri = vscode.Uri.parse('command:positron.assistant.addModelConfiguration');
				welcomeText += `\n\n[Add a Language Model](${commandUri})`;
			}

			const message = new vscode.MarkdownString(welcomeText);
			message.isTrusted = true;

			return {
				icon: new vscode.ThemeIcon('positron-posit-logo'),
				title: 'Positron Assistant',
				message,
			};
		}
	};

	async requestHandler(request: vscode.ChatRequest, context: vscode.ChatContext, response: vscode.ChatResponseStream, token: vscode.CancellationToken) {
		// Handle requests when the user invokes the /quarto command
		const quartoHandler = async () => {
			const system = await fs.promises.readFile(`${mdDir}/prompts/chat/quarto.md`, 'utf8');

			response.markdown('Okay!');
			response.progress('Creating new Quarto document...');
			const document = await vscode.workspace.openTextDocument({
				language: 'quarto',
				content: ''
			});
			const editor = await vscode.window.showTextDocument(document);

			const messages: vscode.LanguageModelChatMessage[] = toLanguageModelChatMessage(context.history);
			messages.push(...[
				vscode.LanguageModelChatMessage.User('Convert to Qmd.'),
			]);

			response.progress('Writing Quarto document...');
			const modelResponse = await request.model.sendRequest(messages, {
				modelOptions: { system },
			}, token);

			for await (const chunk of modelResponse.text) {
				if (token.isCancellationRequested) {
					break;
				}

				// Stream in content to the end of the document
				await editor.edit((builder) => {
					const lastLine = editor.document.lineCount - 1;
					const position = new vscode.Position(lastLine, editor.document.lineAt(lastLine).text.length);
					builder.insert(position, chunk);
				});

				// Check if the last line was visible before the edit
				const lastVisibleRange = editor.visibleRanges[editor.visibleRanges.length - 1];
				const atBottom = lastVisibleRange.end.line >= editor.document.lineCount - 3;

				// If we were at the bottom, scroll to the new bottom
				if (atBottom) {
					const newLastLine = editor.document.lineCount - 1;
					const newPosition = new vscode.Position(newLastLine, 0);
					editor.revealRange(
						new vscode.Range(newPosition, newPosition),
						vscode.TextEditorRevealType.Default
					);
				}
			}
		};

		// Handle requests when no command has been invoked
		const defaultHandler = async () => {
			// System prompt
			let system = await fs.promises.readFile(`${mdDir}/prompts/chat/default.md`, 'utf8');

			// List of tools for use by the Language Model
			const toolOptions: Record<string, any> = {};
			const tools: vscode.LanguageModelChatTool[] = [
				...vscode.lm.tools.filter(tool => tool.tags.includes('positron-assistant')),
				getPlotToolAdapter.lmTool
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
							name: reference.name,
							description,
							documentText,
							selectionText,
						};
						textParts.push(new vscode.LanguageModelTextPart(`\n\n${JSON.stringify(ref)}`));
					} else if (reference.id.startsWith('file://')) {
						const uri = (reference.value as vscode.Uri);
						const document = await vscode.workspace.openTextDocument(uri);
						const documentText = document.getText();
						const ref = { id: reference.id, name: reference.name, documentText };
						textParts.push(new vscode.LanguageModelTextPart(`\n\n${JSON.stringify(ref)}`));
					} else if ('mimeType' in value) {
						const binaryValue = value as vscode.ChatReferenceBinaryData;
						const data = await binaryValue.data();
						binaryReferences[reference.id] = { data: arrayBufferToBase64(data), mimeType: binaryValue.mimeType };
						textParts.push(new vscode.LanguageModelTextPart(`<<referenceBinary:${reference.id}>>`));
					}
				}

				messages.push(...[
					vscode.LanguageModelChatMessage.User(textParts),
					vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
				]);
			}

			// Allow for executing R code in the console.
			system += await fs.promises.readFile(`${mdDir}/prompts/chat/execute.md`, 'utf8');
			tools.push(executeToolAdapter.lmTool);

			// When invoked from the editor, add selection context and editor tool
			if (request.location2 instanceof vscode.ChatRequestEditorData) {
				system += await fs.promises.readFile(`${mdDir}/prompts/chat/editor.md`, 'utf8');
				const document = request.location2.document;
				const selection = request.location2.selection;
				const selectedText = document.getText(selection);
				messages.push(...[
					vscode.LanguageModelChatMessage.User(`The user has selected the following text: ${selectedText}`),
					vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
				]);

				// Add tool to output text edits
				tools.push(textEditToolAdapter.lmTool);
				toolOptions[textEditToolAdapter.name] = { document, selection };
			}

			// When invoked from the terminal, add additional instructions.
			if (request.location === vscode.ChatLocation.Terminal) {
				system += await fs.promises.readFile(`${mdDir}/prompts/chat/terminal.md`, 'utf8');
			}

			// User prompt
			messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

			if (!request.model) {
				const commandUri = vscode.Uri.parse('command:positron.assistant.addModelConfiguration');
				const message = new vscode.MarkdownString(
					`No language models are available. [Click here to add one.](${commandUri})`
				);
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
						// Only follow up on tool requests that are not automatically invoked
						if (!(chunk.name in positronToolAdapters)) {
							toolRequests.push(chunk);
						}
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
						vscode.LanguageModelChatMessage.User(textResponses),
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
		};

		// Select request handler based on the command issued by the user for this request
		switch (request.command) {
			case 'quarto':
				return quartoHandler();
			default:
				return defaultHandler();
		}
	}

	dispose(): void { }
}

const participants: Record<string, positron.ai.ChatParticipant> = {
	'positron-assistant': new PositronAssistantParticipant(),
};
export default participants;
