/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as xml from './xml.js';

import { MARKDOWN_DIR, TOOL_TAG_REQUIRES_ACTIVE_SESSION, TOOL_TAG_REQUIRES_WORKSPACE } from './constants';
import { isChatImageMimeType, isTextEditRequest, isWorkspaceOpen, languageModelCacheBreakpointPart, toLanguageModelChatMessage, uriToString } from './utils';
import { EXPORT_QUARTO_COMMAND, quartoHandler } from './commands/quarto';
import { ContextInfo, PositronAssistantToolName } from './types.js';
import { StreamingTagLexer } from './streamingTagLexer.js';
import { ReplaceStringProcessor } from './replaceStringProcessor.js';
import { ReplaceSelectionProcessor } from './replaceSelectionProcessor.js';
import { log, getRequestTokenUsage } from './extension.js';

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
	private readonly _sessionModels = new Map<string, string>(); // sessionId -> modelId

	registerParticipant(participant: IPositronAssistantParticipant): void {
		this._participants.set(participant.id, participant);

		// Register agent implementation with the vscode API
		const vscodeParticipant = vscode.chat.createChatParticipant(
			participant.id,
			participant.requestHandler.bind(participant),
		);
		vscodeParticipant.iconPath = participant.iconPath;

		// Only register followup provider if enabled
		const followupsEnabled = vscode.workspace.getConfiguration('positron.assistant.followups').get('enable', true);
		if (followupsEnabled) {
			vscodeParticipant.followupProvider = participant.followupProvider;
		}
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

	/**
	 * Track the model used for a chat session.
	 *
	 * @param sessionId The chat session ID
	 * @param modelId The language model ID used for this session
	 */
	trackSessionModel(sessionId: string, modelId: string): void {
		this._sessionModels.set(sessionId, modelId);
	}

	/**
	 * Get the model ID for a chat session.
	 *
	 * @param sessionId The chat session ID
	 * @returns The model ID if found, undefined otherwise
	 */
	getSessionModel(sessionId: string): string | undefined {
		return this._sessionModels.get(sessionId);
	}

	dispose() {
		this._participants.forEach((participant) => participant.dispose());
		this._sessionModels.clear();
	}
}

/** Base class for Positron Assistant chat participants. */
abstract class PositronAssistantParticipant implements IPositronAssistantParticipant {
	abstract id: ParticipantID;
	private readonly _requests = new Map<string, ChatRequestData>();

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _participantService: ParticipantService,
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
			// Check if followups are enabled
			const followupsEnabled = vscode.workspace.getConfiguration('positron.assistant.followups').get('enable', true);
			if (!followupsEnabled) {
				return [];
			}

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
				case EXPORT_QUARTO_COMMAND:
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
		log.debug(`[context] Positron context for request ${request.id}:\n${JSON.stringify(positronContext, null, 2)}`);

		// See IChatRuntimeSessionContext for the structure of the active
		// session context objects
		const activeSessions: Set<string> = new Set();
		let hasVariables = false;
		let hasConsoleSessions = false;
		for (const reference of request.references) {
			const value = reference.value as any;

			// Build a list of languages for which we have active sessions.
			if (value.activeSession) {
				activeSessions.add(value.activeSession.languageId);
				if (value.activeSession.mode === positron.LanguageRuntimeSessionMode.Console) {
					hasConsoleSessions = true;
				}
			}

			// Check if there are variables defined in the session.
			if (value.variables && value.variables.length > 0) {
				hasVariables = true;
			}
		}

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
				const isEditMode = this.id === ParticipantID.Edit;
				const isAgentMode = this.id === ParticipantID.Agent;
				const isStreamingInlineEditor = isStreamingEditsEnabled() && (this.id === ParticipantID.Editor || this.id === ParticipantID.Notebook);

				// If streaming edits are enabled, don't allow any tools in inline editor chats.
				if (isStreamingInlineEditor) {
					return false;
				}

				// If the tool requires a workspace, but no workspace is open, don't allow the tool.
				if (tool.tags.includes(TOOL_TAG_REQUIRES_WORKSPACE) && !isWorkspaceOpen()) {
					return false;
				}

				// If the tool requires an active session, but no active session
				// is available, don't allow the tool.
				if (tool.tags.includes(TOOL_TAG_REQUIRES_ACTIVE_SESSION) && activeSessions.size === 0) {
					return false;
				}

				// If the tool requires a session to be active for a specific
				// language, but no active session is available for that
				// language, don't allow the tool.
				for (const tag of tool.tags) {
					if (tag.startsWith(TOOL_TAG_REQUIRES_ACTIVE_SESSION + ':') &&
						!activeSessions.has(tag.split(':')[1])) {
						return false;
					}
				}

				switch (tool.name) {
					// Only include the execute code tool in the Chat pane; the other
					// panes do not have an affordance for confirming executions.
					//
					// CONSIDER: It would be better for us to introspect the tool itself
					// to see if it requires confirmation, but that information isn't
					// currently exposed in `vscode.LanguageModelChatTool`.
					case PositronAssistantToolName.ExecuteCode:
						// The tool can only be used with console sessions and
						// when in agent mode; it does not currently support
						// notebook mode.
						return inChatPane && hasConsoleSessions && isAgentMode;
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
						return isEditMode || isAgentMode;
					// Only include the documentCreate tool in the chat pane in edit or agent mode.
					case PositronAssistantToolName.DocumentCreate:
						return inChatPane && (isEditMode || isAgentMode);
					// Only include the getTableSummary tool for Python sessions until supported in R
					case PositronAssistantToolName.GetTableSummary:
						// TODO: Remove the python-specific restriction when the tool is supported in R https://github.com/posit-dev/positron/issues/8343
						// The logic above with TOOL_TAG_REQUIRES_ACTIVE_SESSION will handle checking for active sessions once this is removed.
						// We'll still want to check that variables are defined.
						return activeSessions.has('python') && hasVariables;
					// Only include the getPlot tool if there is a plot available.
					case PositronAssistantToolName.GetPlot:
						return positronContext.plots?.hasPlots === true;
					// Only include the inspectVariables tool if there are variables defined.
					case PositronAssistantToolName.InspectVariables:
						return hasVariables;
					// Otherwise, include the tool if it is tagged for use with Positron Assistant.
					// Allow all tools in Agent mode.
					default:
						return isAgentMode ||
							tool.tags.includes('positron-assistant');
				}
			}
		);

		log.debug(`[tools] Available tools for participant ${this.id}:\n${tools.length > 0 ? tools.map((tool, i) => `${i + 1}. ${tool.name}`).join('\n') : 'No tools available'}`);

		// Construct the transient message thread sent to the language model.
		// Note that this is not the same as the chat history shown in the UI.

		// Start with the chat history.
		// Note that context.history excludes tool calls and results.
		const messages = toLanguageModelChatMessage(context.history);

		// Add the user's prompt.
		const userPromptPart = new vscode.LanguageModelTextPart(request.prompt);
		messages.push(vscode.LanguageModelChatMessage.User([userPromptPart]));

		// Add cache breakpoints to at-most the last 2 user messages.
		addCacheControlBreakpointPartsToLastUserMessages(messages, 2);

		// Add a user message containing context about the request, workspace, running sessions, etc.
		// NOTE: We add the context message after the user prompt so that the context message is
		// not cached. Since the context message is transiently added to each request, caching it
		// will write a prompt prefix to the cache that will never be read. We will want to keep
		// an eye on whether the order of user prompt and context message affects model responses.
		const contextInfo = await this.getContextInfo(request, context, response, positronContext);
		if (contextInfo) {
			messages.push(contextInfo.message);
		}

		// Send the request to the language model.
		const tokenUsage = await this.sendLanguageModelRequest(request, response, token, messages, tools, system);

		return {
			metadata: {
				// Attach the model ID as metadata so that we can use the same model in the followup provider.
				modelId: request.model.id,
				// Include token usage if available
				tokenUsage: tokenUsage,
				// Include the tools available for this request
				availableTools: tools.length > 0 ? tools.map(t => t.name) : undefined,
				// Include the context message if available
				positronContext: contextInfo ? { prompts: contextInfo.prompts, attachedDataTypes: contextInfo.attachedDataTypes } : undefined,
				// Include the system prompt used for this request
				systemPrompt: system,
			},
		};
	}

	protected abstract getSystemPrompt(request: vscode.ChatRequest): Promise<string>;

	private async getContextInfo(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		response: vscode.ChatResponseStream,
		positronContext: positron.ai.ChatContext,
	): Promise<ContextInfo | undefined> {
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
				const instructionsNode = xml.node('instructions', llmsText);
				prompts.push(instructionsNode);
				log.debug(`[context] adding llms.txt context: ${llmsText.length} characters`);
			}
		}

		// If the user has explicitly attached a tool reference, add it to the prompt.
		if (request.toolReferences.length > 0) {
			const referencePrompts: string[] = [];
			for (const reference of request.toolReferences) {
				referencePrompts.push(xml.node('tool', reference.name));
			}
			const toolReferencesText = 'Attached tool references:';
			prompts.push(xml.node('tool-references', `${toolReferencesText}\n${referencePrompts.join('\n')}`));
		}


		// If the user has explicitly attached files as context, add them to the prompt.
		if (request.references.length > 0) {
			const attachmentPrompts: string[] = [];
			const sessionPrompts: string[] = [];
			for (const reference of request.references) {
				const value = reference.value as any;
				if (value.activeSession) {
					// The user attached a runtime session - usually the active session in the IDE.
					const sessionSummary = JSON.stringify(value.activeSession, null, 2);
					let sessionContent = sessionSummary;
					if (value.variables) {
						// Include the session variables in the session content.
						const variablesSummary = JSON.stringify(value.variables, null, 2);
						sessionContent += '\n' + xml.node('variables', variablesSummary);
					}
					sessionPrompts.push(xml.node('session', sessionContent));
					log.debug(`[context] adding session context for session ${value.activeSession.identifier}: ${sessionContent.length} characters`);
				} else if (value instanceof vscode.Location) {
					// The user attached a range of a file -
					// usually the automatically attached visible region of the active file.

					const document = await vscode.workspace.openTextDocument(value.uri);
					const path = uriToString(value.uri);
					const documentText = document.getText();
					const visibleText = document.getText(value.range);

					// Add the file as a reference in the response.
					// Although the reference includes a range, we provide the full document text as context
					// and can't distinguish which part the model uses, so we don't include the range in the
					// response reference.
					response.reference(value.uri);

					// Add the visible region prompt.
					const rangeAttachmentNode = xml.node('attachment', visibleText, {
						filePath: path,
						description: 'Visible region of the active file',
						language: document.languageId,
						startLine: value.range.start.line + 1,
						endLine: value.range.end.line + 1,
					});
					const documentAttachmentNode = xml.node('attachment', documentText, {
						filePath: path,
						description: 'Full contents of the active file',
						language: document.languageId,
					});
					attachmentPrompts.push(rangeAttachmentNode, documentAttachmentNode);
					log.debug(`[context] adding file range attachment context: ${rangeAttachmentNode.length} characters`);
					log.debug(`[context] adding file attachment context: ${documentAttachmentNode.length} characters`);
				} else if (value instanceof vscode.Uri) {
					const fileStat = await vscode.workspace.fs.stat(value);
					if (fileStat.type === vscode.FileType.Directory) {
						// The user attached a directory - usually a manually attached directory in the workspace.
						// Format the directory contents for the prompt.
						const entries = await vscode.workspace.fs.readDirectory(value);
						const entriesText = entries.map(([name, type]) => {
							if (type === vscode.FileType.Directory) {
								return `${name}/`;
							}
							return name;
						}).join('\n');
						const path = uriToString(value);

						// TODO: Adding a URI as a response reference shows it in the "Used N references" block.
						//       Files render with the correct icons and when clicked open in the editor.
						//       Folders currently render with the wrong icon and when clicked try to open in the editor,
						//       and opening folders in the editor displays a warning message.
						// response.reference(value);

						// Attach the folder's contents.
						const attachmentNode = xml.node('attachment', entriesText, {
							filePath: path,
							description: 'Contents of the directory',
						});
						attachmentPrompts.push(attachmentNode);
						log.debug(`[context] adding directory attachment context: ${attachmentNode.length} characters`);
					} else {
						// The user attached a file - usually a manually attached file in the workspace.
						const document = await vscode.workspace.openTextDocument(value);
						const path = uriToString(value);
						const documentText = document.getText();

						// Add the file as a reference in the response.
						response.reference(value);

						// Attach the full document text.
						const attachmentNode = xml.node('attachment', documentText, {
							filePath: path,
							description: 'Full contents of the file',
							language: document.languageId,
						});
						attachmentPrompts.push(attachmentNode);
						log.debug(`[context] adding file attachment context: ${attachmentNode.length} characters`);
					}
				} else if (value instanceof vscode.ChatReferenceBinaryData) {
					if (isChatImageMimeType(value.mimeType)) {
						// The user attached an image - usually a pasted image or screenshot of the IDE.
						const data = await value.data();

						// If the binary data is associated with a file, add it as a reference in the response.
						if (value.reference) {
							response.reference(value.reference);
						}

						// Attach the image.
						const imageNode = xml.leaf('img', {
							src: reference.name,
						});
						attachmentPrompts.push(imageNode);
						log.debug(`[context] adding image attachment context: ${data.length} bytes`);

						userDataParts.push(
							vscode.LanguageModelDataPart.image(data, value.mimeType),
						);
					} else {
						log.warn(`Unsupported chat reference binary data type: ${typeof value}`);
					}
				} else {
					log.warn(`Unsupported reference type: ${typeof value}`);
				}
			}

			if (attachmentPrompts.length > 0) {
				// Add the attachments to the prompt.
				const attachmentsText = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'attachments.md'), 'utf8');
				const attachmentsContent = `${attachmentsText}\n${attachmentPrompts.join('\n')}`;
				prompts.push(xml.node('attachments', attachmentsContent));
			}

			if (sessionPrompts.length > 0) {
				// Add the session prompts to the context.
				const sessionText = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'sessions.md'), 'utf8');
				const sessionContent = `${sessionText}\n${sessionPrompts.join('\n')}`;
				prompts.push(xml.node('sessions', sessionContent));
			}
		}

		// Add Positron IDE context to the prompt.
		const positronContextPrompts: string[] = [];

		// Note: Runtime session information (active session, variables, execution history)
		// is now provided through IChatRequestRuntimeSessionEntry mechanism rather than
		// being included in the global positronContext. The chat system will automatically
		// include this information when available.
		if (positronContext.shell) {
			const shellNode = xml.node('shell', positronContext.shell, {
				description: 'Current active shell',
			});
			positronContextPrompts.push(shellNode);
			log.debug(`[context] adding shell context: ${shellNode.length} characters`);
		}
		if (positronContext.plots && positronContext.plots.hasPlots) {
			const plotsNode = xml.node('plots', 'A plot is visible.');
			positronContextPrompts.push(plotsNode);
			log.debug(`[context] adding plots context: ${plotsNode.length} characters`);
		}
		if (positronContext.positronVersion) {
			const versionNode = xml.node('version', `Positron version: ${positronContext.positronVersion}`);
			positronContextPrompts.push(versionNode);
			log.debug(`[context] adding positron version context: ${versionNode.length} characters`);
		}
		if (positronContext.currentDate) {
			const dateNode = xml.node('date', `Today's date is: ${positronContext.currentDate}`);
			positronContextPrompts.push(dateNode);
			log.debug(`[context] adding date context: ${dateNode.length} characters`);
		}
		if (positronContextPrompts.length > 0) {
			prompts.push(xml.node('context', positronContextPrompts.join('\n\n')));
		}

		// Subclasses can override `getCustomPrompt` to append to the context message prompt.
		const customPrompt = await this.getCustomPrompt(request);
		if (customPrompt.length > 0) {
			prompts.push(customPrompt);
		}

		const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [];
		if (prompts.length > 0) {
			const prompt = prompts.join('\n\n');
			parts.push(new vscode.LanguageModelTextPart(prompt));
		}

		parts.push(...userDataParts);

		if (parts.length > 0) {
			return {
				message: vscode.LanguageModelChatMessage2.User(parts),
				prompts,
				attachedDataTypes: userDataParts.map(part => part.mimeType),
			};
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
	): Promise<{ inputTokens?: number; outputTokens?: number } | undefined> {
		if (token.isCancellationRequested) {
			return;
		}

		// Track the model being used for this session
		const toolContext = request.toolInvocationToken as any;
		if (toolContext?.sessionId && request.model?.id) {
			this._participantService.trackSessionModel(toolContext.sessionId, request.model.id);
		}

		const modelResponse = await request.model.sendRequest(messages, {
			tools,
			modelOptions: {
				toolInvocationToken: request.toolInvocationToken,
				system,
				// Pass the request ID through modelOptions for token usage tracking
				requestId: request.id,
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

		// Get actual token usage from the registry
		const tokenUsage = getRequestTokenUsage(request.id);

		// If we do have tool requests to follow up on, use vscode.lm.invokeTool recursively
		if (toolRequests.length > 0) {
			for (const req of toolRequests) {
				if (token.isCancellationRequested) {
					break;
				}

				log.debug(`[tool] Invoking tool ${req.name} with input: ${JSON.stringify(req.input, null, 2)}`);
				const result = await vscode.lm.invokeTool(req.name, {
					input: req.input,
					toolInvocationToken: request.toolInvocationToken,
					model: request.model,
					chatRequestId: request.id,
				}, token);
				log.debug(`[tool] Tool ${req.name} returned result: ${JSON.stringify(result.content, null, 2)}`);
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

		// Return token usage information
		return tokenUsage;
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

	/** Additional language-specific prompts for active sessions */
	protected async getActiveSessionInstructions(): Promise<string> {
		const sessions = await positron.runtime.getActiveSessions();
		const languages = sessions.map((session) => session.runtimeMetadata.languageId);

		const instructions = await Promise.all(languages.map(async (id) => {
			try {
				const instructions = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', `instructions-${id}.md`), 'utf8');
				return instructions + '\n\n';
			} catch {
				// There are no additional instructions for this language ID
				return '';
			}
		}));

		return instructions.join('');
	}

	dispose(): void { }
}

/** The participant used in the chat pane in Ask mode. */
export class PositronAssistantChatParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Chat;

	protected override async getSystemPrompt(request: vscode.ChatRequest): Promise<string> {
		const defaultSystem = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'default.md'), 'utf8');
		const filepaths = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'filepaths.md'), 'utf8');
		const languages = await this.getActiveSessionInstructions();
		const prompts = [defaultSystem, filepaths, languages];
		return prompts.join('\n\n');
	}
}

/** The participant used in the chat pane in Edit mode. */
class PositronAssistantEditParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Edit;

	protected override async getSystemPrompt(request: vscode.ChatRequest): Promise<string> {
		const defaultSystem = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'default.md'), 'utf8');
		const filepaths = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'filepaths.md'), 'utf8');
		const languages = await this.getActiveSessionInstructions();
		const prompts = [defaultSystem, filepaths, languages];
		return prompts.join('\n\n');
	}
}

/** The participant used in the chat pane in Agent mode. */
export class PositronAssistantAgentParticipant extends PositronAssistantParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Agent;

	protected override async getSystemPrompt(request: vscode.ChatRequest): Promise<string> {
		const defaultSystem = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'default.md'), 'utf8');
		const filepaths = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'filepaths.md'), 'utf8');
		const agent = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'agent.md'), 'utf8');
		const languages = await this.getActiveSessionInstructions();
		const prompts = [defaultSystem, filepaths, agent, languages];
		return prompts.join('\n\n');
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
		const filePath = uriToString(document.uri);
		const editorNode = xml.node('editor',
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
		log.debug(`[context] adding editor context: ${editorNode.length} characters`);
		return editorNode;
	}

}

/** The participant used in notebook inline chats. */
class PositronAssistantNotebookParticipant extends PositronAssistantEditorParticipant implements IPositronAssistantParticipant {
	id = ParticipantID.Notebook;
	// For now, the Notebook Participant inherits everything from the Editor Participant.
}

export function registerParticipants(context: vscode.ExtensionContext) {
	// Register the participants service.
	const participantService = new ParticipantService();
	context.subscriptions.push(participantService);

	// Register the Positron Assistant chat participants.
	participantService.registerParticipant(new PositronAssistantChatParticipant(context, participantService));
	participantService.registerParticipant(new PositronAssistantAgentParticipant(context, participantService));
	participantService.registerParticipant(new PositronAssistantTerminalParticipant(context, participantService));
	participantService.registerParticipant(new PositronAssistantEditorParticipant(context, participantService));
	participantService.registerParticipant(new PositronAssistantNotebookParticipant(context, participantService));
	participantService.registerParticipant(new PositronAssistantEditParticipant(context, participantService));

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
 * Whether the experimental streaming edit mode is enabled.
 */
function isStreamingEditsEnabled(): boolean {
	return vscode.workspace.getConfiguration('positron.assistant.streamingEdits').get('enable', true);
}

/** Processes streaming text. */
export interface TextProcessor {
	/** Process a chunk of text. */
	process(chunk: string): void | Promise<void>;

	/** Process any unhandled text at the end of the stream. */
	flush(): void | Promise<void>;
}

/**
 * Add cache breakpoints (for Anthropic prompt caching) to the last few user messages.
 *
 * @param messages The chat messages to modify.
 * @param maxCacheBreakpointParts The maximum number of cache breakpoints to add.
 *   Note that Anthropic supports a maximum of 4 cache controls per request and that
 *   we may also cache tools and the system prompt.
 */
function addCacheControlBreakpointPartsToLastUserMessages(
	messages: vscode.LanguageModelChatMessage2[],
	maxCacheBreakpointParts: number,
) {
	let numCacheControlParts = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== vscode.LanguageModelChatMessageRole.User) {
			continue;
		}
		const lastPart = message.content.at(-1);
		if (!lastPart) {
			continue;
		}
		log.debug(`[participant] Adding cache breakpoint to user message part: ${lastPart.constructor.name}`);
		message.content.push(languageModelCacheBreakpointPart());
		numCacheControlParts++;
		if (numCacheControlParts >= maxCacheBreakpointParts) {
			// We only want to cache the last two user messages.
			break;
		}
	}
}
