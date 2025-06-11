/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as xml from './xml.js';

import { MARKDOWN_DIR } from './constants';
import { isChatImageMimeType, isTextEditRequest, toLanguageModelChatMessage } from './utils';
import { quartoHandler } from './commands/quarto';
import { PositronAssistantToolName } from './types.js';
import { StreamingTagLexer } from './streamingTagLexer.js';
import { ReplaceStringProcessor } from './replaceStringProcessor.js';
import { ReplaceSelectionProcessor } from './replaceSelectionProcessor.js';

export enum ParticipantID {
	/** The participant used in the chat pane in Ask mode. */
	Chat = 'positron.assistant.chat',

	/** The participant used in the chat pane in Edit mode. */
	Edit = 'positron.assistant.editingSessionEditor',

	/** The participant used in the chat pane in Agent mode. */
	Agent = 'positron.assistant.agent',

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
			const system: string = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'followups.md'), 'utf8');
			const messages = toLanguageModelChatMessage(context.history);
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
		const system = await this.getSystemPrompt(request);

		// Get the IDE context for the request.
		const positronContext = await positron.ai.getPositronChatContext(request);

		// List of tools for use by the language model.
		const tools: vscode.LanguageModelChatTool[] = vscode.lm.tools.filter(
			tool => {
				// Don't allow any tools in the terminal.
				if (this.id === ParticipantID.Terminal) {
					return false;
				}

				// Define more readable variables for filtering.
				const inChatPane = request.location2 === undefined;
				const inEditor = request.location2 instanceof vscode.ChatRequestEditorData;
				const hasSelection = inEditor && request.location2.selection?.isEmpty === false;

				// If streaming edits are enabled, don't allow any tools in inline editor chats.
				if (isStreamingEditsEnabled() && this.id === ParticipantID.Editor) {
					return false;
				}

				switch (tool.name) {
					// Only include the execute code tool in the Chat pane; the other
					// panes do not have an affordance for confirming executions.
					//
					// CONSIDER: It would be better for us to introspect the tool itself
					// to see if it requires confirmation, but that information isn't
					// currently exposed in `vscode.LanguageModelChatTool`.
					case PositronAssistantToolName.ExecuteCode:
						return inChatPane &&
							// The execute code tool does not yet support notebook sessions.
							positronContext.activeSession?.mode !== positron.LanguageRuntimeSessionMode.Notebook &&
							this.id === ParticipantID.Agent;
					// Only include the documentEdit tool in an editor and if there is
					// no selection.
					case PositronAssistantToolName.DocumentEdit:
						return inEditor && !hasSelection;
					// Only include the selectionEdit tool in an editor and if there is
					// a selection.
					case PositronAssistantToolName.SelectionEdit:
						return inEditor && hasSelection;
					// Only include the edit file tool in edit or agent mode i.e. for the edit participant.
					case PositronAssistantToolName.EditFile:
						return this.id === ParticipantID.Edit || this.id === ParticipantID.Agent;
					// Otherwise, include the tool if it is tagged for use with Positron Assistant.
					// Allow all tools in Agent mode.
					default:
						return this.id === ParticipantID.Agent ||
							tool.tags.includes('positron-assistant');
				}
			}
		);

		// Construct the transient message thread sent to the language model.
		// Note that this is not the same as the chat history shown in the UI.

		// Start with the chat history.
		// Note that context.history excludes tool calls and results.
		const messages = toLanguageModelChatMessage(context.history);

		// Add a user message containing context about the request, workspace, running sessions, etc.
		const contextMessage = await this.getContextMessage(request, response, positronContext);
		if (contextMessage) {
			messages.push(contextMessage);
		}

		// Add the user's prompt.
		messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

		// Send the request to the language model.
		await this.sendLanguageModelRequest(request, response, token, messages, tools, system);

		return {
			metadata: {
				// Attach the model ID as metadata so that we can use the same model in the followup provider.
				modelId: request.model.id
			},
		};
	}

	protected abstract getSystemPrompt(request: vscode.ChatRequest): Promise<string>;

	private async getContextMessage(
		request: vscode.ChatRequest,
		response: vscode.ChatResponseStream,
		positronContext: positron.ai.ChatContext,
	): Promise<vscode.LanguageModelChatMessage2 | undefined> {
		// This function returns a single user message containing all context
		// relevant to a request, including:
		// 1. A text prompt.
		const prompts: string[] = [];
		// 2. Binary data (e.g. image attachments).
		const userDataParts: vscode.LanguageModelDataPart[] = [];

		// If the workspace has an llms.txt document, add it's current value to the prompt.
		const llmsDocument = await openLlmsTextDocument();
		if (llmsDocument) {
			const llmsText = llmsDocument.getText();
			if (llmsText.trim() !== '') {
				// Add the file as a reference in the response.
				response.reference(llmsDocument.uri);

				// Add the contents of the file to the prompt
				prompts.push(xml.node('instructions', llmsText));
			}
		}

		// If the user has explicitly attached files as context, add them to the prompt.
		if (request.references.length > 0) {
			const attachmentPrompts: string[] = [];
			for (const reference of request.references) {
				const value = reference.value;
				if (value instanceof vscode.Location) {
					// The user attached a range of a file -
					// usually the automatically attached visible region of the active file.

					const document = await vscode.workspace.openTextDocument(value.uri);
					const path = vscode.workspace.asRelativePath(value.uri);
					const documentText = document.getText();
					const visibleText = document.getText(value.range);

					// Add the file as a reference in the response.
					// Although the reference includes a range, we provide the full document text as context
					// and can't distinguish which part the model uses, so we don't include the range in the
					// response reference.
					response.reference(value.uri);

					// Add the visible region prompt.
					attachmentPrompts.push(xml.node('attachment', visibleText, {
						filePath: path,
						description: 'Visible region of the active file',
						language: document.languageId,
						startLine: value.range.start.line + 1,
						endLine: value.range.end.line + 1,
					}));

					// Add the full document text prompt.
					attachmentPrompts.push(xml.node('attachment', documentText, {
						filePath: path,
						description: 'Full contents of the active file',
						language: document.languageId,
					}));
				} else if (value instanceof vscode.Uri) {
					// The user attached a file - usually a manually attached file in the workspace.
					const document = await vscode.workspace.openTextDocument(value);
					const path = vscode.workspace.asRelativePath(value);
					const documentText = document.getText();

					// Add the file as a reference in the response.
					response.reference(value);

					// Attach the full document text.
					attachmentPrompts.push(xml.node('attachment', documentText, {
						filePath: path,
						description: 'Full contents of the file',
						language: document.languageId,
					}));
				} else if (value instanceof vscode.ChatReferenceBinaryData) {
					if (isChatImageMimeType(value.mimeType)) {
						// The user attached an image - usually a pasted image or screenshot of the IDE.
						const data = await value.data();

						// If the binary data is associated with a file, add it as a reference in the response.
						if (value.reference) {
							response.reference(value.reference);
						}

						// Attach the image.
						attachmentPrompts.push(xml.leaf('img', {
							src: reference.name,
						}));

						userDataParts.push(
							vscode.LanguageModelDataPart.image(data, value.mimeType),
						);
					} else {
						console.warn(`Positron Assistant: Unsupported chat reference binary data type: ${typeof value}`);
					}
				} else {
					console.warn(`Positron Assistant: Unsupported reference type: ${typeof value}`);
				}
			}

			if (attachmentPrompts.length > 0) {
				// Add the attachments to the prompt.
				const attachmentsText = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'attachments.md'), 'utf8');
				const attachmentsContent = `${attachmentsText}\n${attachmentPrompts.join('\n')}`;
				prompts.push(xml.node('attachments', attachmentsContent));
			}
		}

		// Add Positron IDE context to the prompt.
		const positronContextPrompts: string[] = [];
		if (positronContext.activeSession) {
			const executions = positronContext.activeSession.executions
				.map((e) => xml.node('execution', JSON.stringify(e)))
				.join('\n');
			positronContextPrompts.push(
				xml.node('session',
					xml.node('executions', executions ?? ''), {
					description: 'Current active session',
					language: positronContext.activeSession.language,
					version: positronContext.activeSession.version,
					mode: positronContext.activeSession.mode,
					identifier: positronContext.activeSession.identifier,
				})
			);
		}
		if (positronContext.variables) {
			const content = positronContext.variables
				.map((v) => xml.node('variable', JSON.stringify(v)))
				.join('\n');
			const description = content.length > 0 ?
				'Variables defined in the current session' :
				'No variables defined in the current session';
			positronContextPrompts.push(
				xml.node('variables', content, {
					description,
				})
			);
		}
		if (positronContext.shell) {
			positronContextPrompts.push(
				xml.node('shell', positronContext.shell, {
					description: 'Current active shell',
				})
			);
		}
		if (positronContext.plots && positronContext.plots.hasPlots) {
			positronContextPrompts.push(
				xml.node('plots', 'A plot is visible.')
			);
		}
		if (positronContext.currentDate) {
			positronContextPrompts.push(
				xml.node('date', `Today's date is: ${positronContext.currentDate}`),
			);
		}
		if (positronContextPrompts.length > 0) {
			prompts.push(xml.node('context', positronContextPrompts.join('\n\n')));
		}

		// Subclasses can override `getCustomPrompt` to append to the context message prompt.
		const customPrompt = await this.getCustomPrompt(request);
		if (customPrompt.length > 0) {
			prompts.push(customPrompt);
		}

		// Add default context items to the prompt just before the prompts are joined.
		// This ordering helps with verifying the context items in tests, as we can expect
		// them to be at the end of the prompt.
		prompts.push(...getDefaultContextItems());

		const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [];
		if (prompts.length > 0) {
			const prompt = prompts.join('\n\n');
			parts.push(new vscode.LanguageModelTextPart(prompt));
		}

		parts.push(...userDataParts);

		if (parts.length > 0) {
			return vscode.LanguageModelChatMessage2.User(parts);
		}

		return undefined;
	}

	/** Custom prompt for this participant, added before the user prompt. */
	protected async getCustomPrompt(request: vscode.ChatRequest): Promise<string> {
		return '';
	}

	private async sendLanguageModelRequest(
		request: vscode.ChatRequest,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
		messages: (vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
		tools: vscode.LanguageModelChatTool[],
		system: string,
	): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}

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

		// Create a streaming text processor to allow the model to stream to the chat
		// response e.g. using a loose XML format.
		// This will be undefined if the current context does not require a text processor.
		const textProcessor = this.createTextProcessor(request, response);

		for await (const chunk of modelResponse.stream) {
			if (token.isCancellationRequested) {
				break;
			}

			if (chunk instanceof vscode.LanguageModelTextPart) {
				textResponses.push(chunk);

				console.log(chunk.value);
				if (textProcessor) {
					// If there is a text processor, let it process the chunk
					// and write to the chat response stream.
					await textProcessor.process(chunk.value);
				} else {
					// If there is no text processor, treat the chunk as markdown.
					response.markdown(chunk.value);
				}
			} else if (chunk instanceof vscode.LanguageModelToolCallPart) {
				toolRequests.push(chunk);
			}
		}

		// Flush the text processor, if needed.
		if (textProcessor) {
			await textProcessor.flush();
		}

		// If we do have tool requests to follow up on, use vscode.lm.invokeTool recursively
		if (toolRequests.length > 0) {
			for (const req of toolRequests) {
				if (token.isCancellationRequested) {
					break;
				}

				const result = await vscode.lm.invokeTool(req.name, {
					input: req.input,
					toolInvocationToken: request.toolInvocationToken,
					model: request.model,
					chatRequestId: request.id,
				}, token);
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

	/**
	 * Create a streaming text processor for a given request.
	 *
	 * The text processor will be given chunks of text from the language model
	 * and is expected to write to the chat response stream.
	 *
	 * @param request The current chat request.
	 * @param response The chat response stream to write to.
	 * @returns A text processor that handles the request, or undefined if no
	 *  streaming is needed for the request.
	 */
	private createTextProcessor(request: vscode.ChatRequest, response: vscode.ChatResponseStream): TextProcessor | undefined {
		// Currently, we only use streaming text processing in the experimental streaming edit mode.
		if (!isStreamingEditsEnabled() || !isTextEditRequest(request)) {
			return undefined;
		}

		// If the selection is empty, stream string replacements to the document.
		if (request.location2.selection.isEmpty) {
			const replaceStringProcessor = new ReplaceStringProcessor(request.location2.document, response);
			return new StreamingTagLexer({
				tagNames: ReplaceStringProcessor.TagNames,
				contentHandler(chunk) {
					replaceStringProcessor.process(chunk);
				},
			});
		}

		// If the selection is not empty, stream edits to the selection.
		const replaceSelectionProcessor = new ReplaceSelectionProcessor(
			request.location2.document.uri,
			request.location2.selection,
			response,
		);
		return new StreamingTagLexer({
			tagNames: ReplaceSelectionProcessor.TagNames,
			contentHandler(chunk) {
				replaceSelectionProcessor.process(chunk);
			}
		});
	}

	dispose(): void { }
}

/** The participant used in the chat pane in Ask mode. */
export class PositronAssistantChatParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Chat;

	protected override async getSystemPrompt(request: vscode.ChatRequest): Promise<string> {
		const defaultSystem = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'default.md'), 'utf8');
		const filepaths = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'filepaths.md'), 'utf8');
		return defaultSystem + '\n\n' + filepaths;
	}
}

/** The participant used in the chat pane in Agent mode. */
export class PositronAssistantAgentParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Agent;

	protected override async getSystemPrompt(request: vscode.ChatRequest): Promise<string> {
		const defaultSystem = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'default.md'), 'utf8');
		const agent = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'agent.md'), 'utf8');
		return defaultSystem + '\n\n' + agent;
	}
}

/** The participant used in terminal inline chats. */
class PositronAssistantTerminalParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Terminal;

	protected override async getSystemPrompt(request: vscode.ChatRequest): Promise<string> {
		return await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'terminal.md'), 'utf8');
	}
}

/** The participant used in editor inline chats. */
export class PositronAssistantEditorParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Editor;

	protected override async getSystemPrompt(request: vscode.ChatRequest): Promise<string> {
		if (!isTextEditRequest(request)) {
			throw new Error(`Editor participant only supports editor requests. Got: ${typeof request.location2}`);
		}

		if (isStreamingEditsEnabled()) {
			// If the user has not selected text, use the prompt for the whole document.
			if (request.location2.selection.isEmpty) {
				return await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'editorStreaming.md'), 'utf8');
			}

			// If the user has selected text, generate a new version of the selection.
			return await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'selectionStreaming.md'), 'utf8');
		}

		const defaultSystem = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'default.md'), 'utf8');

		// If the user has not selected text, use the prompt for the whole document.
		if (request.location2.selection.isEmpty) {
			const editor = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'editor.md'), 'utf8');
			return defaultSystem + '\n\n' + editor;
		}

		// If the user has selected text, generate a new version of the selection.
		const selection = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'selection.md'), 'utf8');
		return defaultSystem + '\n\n' + selection;
	}

	async getCustomPrompt(request: vscode.ChatRequest): Promise<string> {
		if (!isTextEditRequest(request)) {
			throw new Error(`Editor participant only supports editor requests. Got: ${typeof request.location2}`);
		}

		// Note: in this case, the current visible region of the document is not
		// included as an attachment in the request.

		// When invoked from the editor, add document and selection context
		const document = request.location2.document;
		const selection = request.location2.selection;
		const selectedText = document.getText(selection);
		const documentText = document.getText();
		const filePath = vscode.workspace.asRelativePath(document.uri);
		return xml.node('editor',
			[
				xml.node('document', documentText, {
					description: 'Full contents of the active file',
				}),
				xml.node('selection', selectedText, {
					description: 'Selected text in the active file',
				})
			].join('\n'),
			{
				description: 'Current active editor',
				filePath,
				language: document.languageId,
				line: selection.active.line + 1,
				column: selection.active.character + 1,
				documentOffset: document.offsetAt(selection.active),
			},
		);
	}

}

/** The participant used in notebook inline chats. */
class PositronAssistantNotebookParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Notebook;

	protected override async getSystemPrompt(request: vscode.ChatRequest): Promise<string> {
		return await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'default.md'), 'utf8');
	}
}

/** The participant used in the chat pane in Edit mode. */
class PositronAssistantEditParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Edit;

	protected override async getSystemPrompt(request: vscode.ChatRequest): Promise<string> {
		const defaultSystem = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'default.md'), 'utf8');
		const filepaths = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'filepaths.md'), 'utf8');
		return defaultSystem + '\n\n' + filepaths;
	}
}

export function registerParticipants(context: vscode.ExtensionContext) {
	// Register the participants service.
	const participantService = new ParticipantService();
	context.subscriptions.push(participantService);

	// Register the Positron Assistant chat participants.
	participantService.registerParticipant(new PositronAssistantChatParticipant(context));
	participantService.registerParticipant(new PositronAssistantAgentParticipant(context));
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

/**
 * Retrieve the default context items to include in the prompt.
 * @returns A list of default context items to include in the prompt.
 */
export function getDefaultContextItems(): string[] {
	const defaultPrompts = [];

	// Note if any folders are open in the workspace.
	const areFoldersOpen = !!vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
	defaultPrompts.push(xml.node('workspace', `Workspace folders are open: ${areFoldersOpen}`));

	return defaultPrompts;
}

/**
 * Whether the experimental streaming edit mode is enabled.
 */
function isStreamingEditsEnabled(): boolean {
	return vscode.workspace.getConfiguration('positron.assistant.streamingEdits').get('enable', false);
}

/** Processes streaming text. */
export interface TextProcessor {
	/** Process a chunk of text. */
	process(chunk: string): void | Promise<void>;

	/** Process any unhandled text at the end of the stream. */
	flush(): void | Promise<void>;
}
