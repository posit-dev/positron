/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as fs from 'fs';

import { EXTENSION_ROOT_DIR } from './constants';
import { isChatImageMimeType, toLanguageModelChatMessage } from './utils';
import { quartoHandler } from './commands/quarto';
import { PositronAssistantToolName } from './tools.js';

const mdDir = `${EXTENSION_ROOT_DIR}/src/md/`;

export enum ParticipantID {
	/** The participant used in the chat pane in Ask mode. */
	Chat = 'positron.assistant.chat',

	/** The participant used in the chat pane in Edit mode. */
	Edit = 'positron.assistant.editingSessionEditor',

	/** The participant used in editor inline chats. */
	Editor = 'positron.assistant.editor',

	/** The participant used in terminal inline chats. */
	Terminal = 'positron.assistant.terminal',

	/** The participant used in notebook inline chats. */
	Notebook = 'positron.assistant.notebook',
}

export interface ChatRequestData {
	request: vscode.ChatRequest;
	context: vscode.ChatContext;
	response: vscode.ChatResponseStream;
}

export interface IPositronAssistantParticipant extends vscode.ChatParticipant {
	id: ParticipantID;
	getRequestData(chatRequestId: string): ChatRequestData | undefined;
}

export class ParticipantService implements vscode.Disposable {
	private readonly _participants = new Map<ParticipantID, IPositronAssistantParticipant>();

	registerParticipant(participant: IPositronAssistantParticipant): void {
		this._participants.set(participant.id, participant);

		// Register agent implementation with the vscode API
		const vscodeParticipant = vscode.chat.createChatParticipant(
			participant.id,
			participant.requestHandler.bind(participant),
		);
		vscodeParticipant.iconPath = participant.iconPath;
		vscodeParticipant.followupProvider = participant.followupProvider;
		vscodeParticipant.welcomeMessageProvider = participant.welcomeMessageProvider;
	}

	getRequestData(chatRequestId: string): ChatRequestData | undefined {
		for (const participant of this._participants.values()) {
			const data = participant.getRequestData(chatRequestId);
			if (data) {
				return data;
			}
		}
		return undefined;
	}

	dispose() {
		this._participants.forEach((participant) => participant.dispose());
	}
}

/** Base class for Positron Assistant chat participants. */
abstract class PositronAssistantParticipant implements IPositronAssistantParticipant {
	abstract id: ParticipantID;
	private readonly _requests = new Map<string, ChatRequestData>();

	constructor(
		private readonly _context: vscode.ExtensionContext,
	) { }
	readonly iconPath = new vscode.ThemeIcon('positron-assistant');

	readonly _receiveFeedbackEventEmitter = new vscode.EventEmitter<vscode.ChatResultFeedback>();
	onDidReceiveFeedback: vscode.Event<vscode.ChatResultFeedback> = this._receiveFeedbackEventEmitter.event;

	readonly _performActionEventEmitter = new vscode.EventEmitter<vscode.ChatUserActionEvent>();
	onDidPerformAction: vscode.Event<vscode.ChatUserActionEvent> = this._performActionEventEmitter.event;

	readonly _pauseStateEventEmitter = new vscode.EventEmitter<vscode.ChatParticipantPauseStateEvent>();
	onDidChangePauseState: vscode.Event<vscode.ChatParticipantPauseStateEvent> = this._pauseStateEventEmitter.event;

	readonly followupProvider: vscode.ChatFollowupProvider = {
		async provideFollowups(result: vscode.ChatResult, context: vscode.ChatContext, token: vscode.CancellationToken): Promise<vscode.ChatFollowup[]> {
			const system: string = await fs.promises.readFile(`${mdDir}/prompts/chat/followups.md`, 'utf8');
			const messages: vscode.LanguageModelChatMessage[] = toLanguageModelChatMessage(context.history);
			messages.push(vscode.LanguageModelChatMessage.User('Summarise and suggest follow-ups.'));

			const models = await vscode.lm.selectChatModels({ id: result.metadata?.modelId });
			if (models.length === 0) {
				throw new Error(vscode.l10n.t('Selected model not available.'));
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
		async provideSampleQuestions(location: vscode.ChatLocation, token: vscode.CancellationToken): Promise<vscode.ChatFollowup[]> {
			/*
			let welcomeText;
			const addLanguageModelMessage = vscode.l10n.t('Add a Language Model.');

			// Show an extra configuration link if there are no configured models yet
			if (getStoredModels(this._context).length === 0) {
				welcomeText = await fs.promises.readFile(`${mdDir}/welcome.md`, 'utf8');
				const commandUri = vscode.Uri.parse('command:positron-assistant.addModelConfiguration');
				welcomeText += `\n\n[${addLanguageModelMessage}](${commandUri})`;
			} else {
				welcomeText = await fs.promises.readFile(`${mdDir}/welcomeready.md`, 'utf8');
				// TODO: Replace with guide link once it has been created
				const guideLink = vscode.Uri.parse('https://positron.posit.co');
				welcomeText = welcomeText.replace('{guide-link}', `[${vscode.l10n.t('Positron Assistant User Guide')}](${guideLink})`);
			}

			const message = new vscode.MarkdownString(welcomeText, true);
			message.isTrusted = true;
			*/

			return [{
				label: vscode.l10n.t('Positron Assistant'),
				participant: ParticipantID.Chat,
				prompt: 'Analyze the data in my workspace and visualize your key findings',
			}];
		}
	};

	async requestHandler(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
	) {
		this._requests.set(request.id, { request, context, response });

		// Select request handler based on the command issued by the user for this request
		try {
			switch (request.command) {
				case 'quarto':
					return await quartoHandler(request, context, response, token);
				default:
					return await this.defaultRequestHandler(request, context, response, token);
			}
		} finally {
			this._requests.delete(request.id);
		}
	}

	public getRequestData(chatRequestId: string): ChatRequestData | undefined {
		return this._requests.get(chatRequestId);
	}

	private async defaultRequestHandler(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
	) {
		// System prompt.
		const defaultSystem = await this.getDefaultSystemPrompt();
		// Subclasses can override `getSystemPrompt` to append to the default system prompt.
		const customSystem = (await this.getSystemPrompt(request)) ?? '';
		const system = defaultSystem + customSystem;

		// List of tools for use by the language model.
		const tools: vscode.LanguageModelChatTool[] = vscode.lm.tools.filter(
			tool => {
				// Define more readable variables for filtering.
				const inChatPane = request.location2 === undefined;
				const inEditor = request.location2 instanceof vscode.ChatRequestEditorData;
				const hasSelection = inEditor && request.location2.selection?.isEmpty === false;

				switch (tool.name) {
					// Only include the execute code tool in the Chat pane; the other
					// panes do not have an affordance for confirming executions.
					//
					// CONSIDER: It would be better for us to introspect the tool itself
					// to see if it requires confirmation, but that information isn't
					// currently exposed in `vscode.LanguageModelChatTool`.
					case PositronAssistantToolName.ExecuteCode:
						return inChatPane;
					// Only include the documentEdit tool in an editor and if there is
					// no selection.
					case PositronAssistantToolName.DocumentEdit:
						return inEditor && !hasSelection;
					// Only include the selectionEdit tool in an editor and if there is
					// a selection.
					case PositronAssistantToolName.SelectionEdit:
						return inEditor && hasSelection;
					// Only include the edit file tool in edit mode i.e. for the edit participant.
					case PositronAssistantToolName.EditFile:
						return this.id === ParticipantID.Edit;
					// Otherwise, include the tool if it is tagged for use with Positron Assistant.
					default:
						return tool.tags.includes('positron-assistant');
				}
			}
		);

		// Construct the language model request.
		const messages = await this.getDefaultMessages(request, context, response);

		// Send the request to the language model.
		await this.sendLanguageModelRequest(request, response, token, messages, tools, system);

		return {
			metadata: {
				// Attach the model ID as metadata so that we can use the same model in the followup provider.
				modelId: request.model.id
			},
		};
	}

	private async getDefaultSystemPrompt(): Promise<string> {
		return await fs.promises.readFile(`${mdDir}/prompts/chat/default.md`, 'utf8');
	}

	/**
	 * A custom system prompt for this participant that is appended to the default system prompt.
	 */
	protected async getSystemPrompt(request: vscode.ChatRequest): Promise<string | undefined> {
		return undefined;
	}

	private async getDefaultMessages(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		response: vscode.ChatResponseStream,
	) {
		// The transient message thread sent to the language model.
		// This will include messages from the persisted chat history,
		// but this message thread will not be persisted.
		const messages: vscode.LanguageModelChatMessage2[] = [];

		// If the workspace has an llms.txt document, add it's current value to the message thread.
		const llmsDocument = await openLlmsTextDocument();
		if (llmsDocument) {
			const llmsText = llmsDocument.getText();
			if (llmsText.trim() !== '') {
				// Add the file as a reference in the response.
				response.reference(llmsDocument.uri);

				// Add the contents of the file to the message thread.
				messages.push(
					vscode.LanguageModelChatMessage.User(llmsText),
					vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
				);
			}
		}

		// Add the persisted chat history to the message thread.
		const historyMessages: vscode.LanguageModelChatMessage[] = toLanguageModelChatMessage(context.history);
		messages.push(...historyMessages);

		// Add Positron specific context to the message thread.
		const positronContext = await positron.ai.getPositronChatContext(request);
		messages.push(
			vscode.LanguageModelChatMessage.User(JSON.stringify(positronContext)),
			vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
		);

		// If the user has explicitly attached files as context, add them to the message thread.
		if (request.references.length > 0) {
			const attachmentsText = await fs.promises.readFile(`${mdDir}/prompts/chat/attachments.md`, 'utf8');
			const userParts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [
				new vscode.LanguageModelTextPart(attachmentsText)
			];
			for (const reference of request.references) {
				const value = reference.value;
				if (value instanceof vscode.Location) {
					const description = reference.modelDescription;
					const document = await vscode.workspace.openTextDocument(value.uri);
					const documentText = document.getText();
					const selectionText = document.getText(value.range);
					const ref = {
						id: reference.id,
						uri: value.uri.toString(),
						description,
						documentText,
						selectionText,
					};
					// Add the file as a reference in the response.
					// Although the reference includes a range, we provide the full document text as context
					// and can't distinguish which part the model uses, so we don't include the range in the
					// response reference.
					response.reference(value.uri);
					userParts.push(new vscode.LanguageModelTextPart(`\n\n${JSON.stringify(ref)}`));
				} else if (value instanceof vscode.Uri) {
					const document = await vscode.workspace.openTextDocument(value);
					const documentText = document.getText();
					const ref = { id: reference.id, uri: value.toString(), documentText };
					// Add the file as a reference in the response.
					response.reference(value);
					userParts.push(new vscode.LanguageModelTextPart(`\n\n${JSON.stringify(ref)}`));
				} else if (value instanceof vscode.ChatReferenceBinaryData) {
					if (isChatImageMimeType(value.mimeType)) {
						const data = await value.data();
						if (value.reference) {
							// If the binary data is associated with a file, add it as a reference in the response.
							response.reference(value.reference);
						}
						userParts.push(
							new vscode.LanguageModelTextPart(`Attached image name: ${reference.name}`),
							new vscode.LanguageModelDataPart(data, value.mimeType),
						);
					} else {
						console.warn(`Positron Assistant: Unsupported chat reference binary data type: ${typeof value}`);
					}
				} else {
					console.warn(`Positron Assistant: Unsupported reference type: ${typeof value}`);
				}
			}
			messages.push(
				vscode.LanguageModelChatMessage2.User(userParts),
				vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
			);
		}

		// Subclasses can override `getMessages` to add custom messages before the user prompt.
		const customMessages = await this.getMessages(request);
		messages.push(...customMessages);

		// User prompt
		messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

		return messages;
	}

	/** Custom language model messages for this participant, added before the user prompt. */
	protected async getMessages(request: vscode.ChatRequest): Promise<vscode.LanguageModelChatMessage[]> {
		return [];
	}

	private async sendLanguageModelRequest(
		request: vscode.ChatRequest,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
		messages: vscode.LanguageModelChatMessage2[],
		tools: vscode.LanguageModelChatTool[],
		system: string,
	): Promise<void> {
		const modelResponse = await request.model.sendRequest(messages, {
			tools,
			modelOptions: {
				toolInvocationToken: request.toolInvocationToken,
				system,
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
			for (const req of toolRequests) {
				const result = await vscode.lm.invokeTool(req.name, {
					input: req.input,
					toolInvocationToken: request.toolInvocationToken,
					model: request.model,
					chatRequestId: request.id,
				});
				toolResponses[req.callId] = result;
			}

			const newMessages = [
				...messages,
				vscode.LanguageModelChatMessage.Assistant(textResponses),
				vscode.LanguageModelChatMessage.Assistant(toolRequests),
				vscode.LanguageModelChatMessage.User(
					Object.entries(toolResponses).map(([id, resp]) => {
						return new vscode.LanguageModelToolResultPart(id, resp.content);
					})
				),
			];
			return this.sendLanguageModelRequest(request, response, token, newMessages, tools, system);
		}
	}

	dispose(): void { }
}

/** The participant used in the chat pane in Ask mode. */
class PositronAssistantChatParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Chat;

	protected override async getSystemPrompt(request: vscode.ChatRequest): Promise<string | undefined> {
		return await fs.promises.readFile(`${mdDir}/prompts/chat/filepaths.md`, 'utf8');
	}
}

/** The participant used in terminal inline chats. */
class PositronAssistantTerminalParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Terminal;

	protected override async getSystemPrompt(request: vscode.ChatRequest): Promise<string | undefined> {
		return await fs.promises.readFile(`${mdDir}/prompts/chat/terminal.md`, 'utf8');
	}
}

/** The participant used in editor inline chats. */
class PositronAssistantEditorParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Editor;

	protected override async getSystemPrompt(request: vscode.ChatRequest): Promise<string | undefined> {
		if (!(request.location2 instanceof vscode.ChatRequestEditorData)) {
			throw new Error('Editor participant only supports editor requests');
		}

		// If the user has not selected text, use the prompt for the whole document.
		if (request.location2.selection.isEmpty) {
			return await fs.promises.readFile(`${mdDir}/prompts/chat/editor.md`, 'utf8');
		}

		// If the user has selected text, generate a new version of the selection.
		return await fs.promises.readFile(`${mdDir}/prompts/chat/selection.md`, 'utf8');
	}

	async getMessages(request: vscode.ChatRequest): Promise<vscode.LanguageModelChatMessage[]> {
		if (!(request.location2 instanceof vscode.ChatRequestEditorData)) {
			throw new Error('Editor participant only supports editor requests');
		}

		// When invoked from the editor, add document and selection context
		const document = request.location2.document;
		const selection = request.location2.selection;
		const selectedText = document.getText(selection);
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
		return [
			vscode.LanguageModelChatMessage.User(textParts),
			vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
		];
	}
}

/** The participant used in notebook inline chats. */
class PositronAssistantNotebookParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Notebook;
}

/** The participant used in the chat pane in Edit mode. */
class PositronAssistantEditParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Edit;

	protected override async getSystemPrompt(request: vscode.ChatRequest): Promise<string | undefined> {
		return await fs.promises.readFile(`${mdDir}/prompts/chat/filepaths.md`, 'utf8');
	}
}

export function registerParticipants(context: vscode.ExtensionContext) {
	// Register the participants service.
	const participantService = new ParticipantService();
	context.subscriptions.push(participantService);

	// Register the Positron Assistant chat participants.
	participantService.registerParticipant(new PositronAssistantChatParticipant(context));
	participantService.registerParticipant(new PositronAssistantTerminalParticipant(context));
	participantService.registerParticipant(new PositronAssistantEditorParticipant(context));
	participantService.registerParticipant(new PositronAssistantNotebookParticipant(context));
	participantService.registerParticipant(new PositronAssistantEditParticipant(context));

	return participantService;
}

async function openLlmsTextDocument(): Promise<vscode.TextDocument | undefined> {
	// If the workspace has an llms.txt document, add it's current value to the message thread.
	if (!vscode.workspace.workspaceFolders) {
		return undefined;
	}

	const fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, `llms.txt`);
	const fileExists = await vscode.workspace.fs.stat(fileUri).then(() => true, () => false);
	if (!fileExists) {
		return undefined;
	}

	const llmsDocument = await vscode.workspace.openTextDocument(fileUri);
	return llmsDocument;
}
